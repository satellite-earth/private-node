import { type Database } from 'better-sqlite3';
import { Debugger } from 'debug';
import { Filter, NostrEvent, Relay, Subscription } from 'nostr-tools';

import { NostrRelay } from '../../../core/dist/index.js';
import { LabeledEventStore } from './labeled-event-store.js';
import { HyperConnectionManager } from './hyper-connection-manager.js';
import { logger } from '../logger.js';

export class CommunityProxy {
	log: Debugger;
	db: Database;
	connectionManager: HyperConnectionManager;
	definition: NostrEvent;

	upstream?: Relay;
	eventStore: LabeledEventStore;
	relay: NostrRelay;

	get addresses() {
		return this.definition.tags.filter((t) => t[0] === 'r' && t[1]).map((t) => t[1]);
	}

	constructor(db: Database, communityDefinition: NostrEvent, connectionManager: HyperConnectionManager) {
		this.db = db;
		this.connectionManager = connectionManager;
		this.definition = communityDefinition;
		this.log = logger.extend('community-proxy:' + communityDefinition.pubkey);

		this.eventStore = new LabeledEventStore(this.db, communityDefinition.pubkey);
		this.relay = new NostrRelay(this.eventStore);

		this.relay.on('event:received', (event) => {
			// send event to upstream relay
			if (this.upstream) {
				this.log('Sending event to upstream', event.id);
				this.upstream.publish(event);
			}
		});
		this.relay.on('subscription:created', (subscription, ws) => {
			this.syncChannelsFromFilters(subscription.filters);
		});
		this.relay.on('subscription:updated', (subscription, ws) => {
			this.syncChannelsFromFilters(subscription.filters);
		});
	}

	protected async connectUpstream() {
		if (this.upstream) {
			this.upstream.close();
			this.upstream = undefined;
		}

		const hyperAddress = this.definition.tags.find((t) => t[0] === 'r' && t[1] && t[2] === 'hyper')?.[1];
		let address = this.definition.tags.find((t) => t[0] === 'r' && t[1].startsWith('ws'))?.[1];

		if (hyperAddress) {
			const serverInfo = await this.connectionManager.getLocalAddress(hyperAddress);
			address = new URL(`ws://${serverInfo.address}:${serverInfo.port}`).toString();
			this.log('Bound hyper address to', address);
		}

		if (!address) throw new Error('Failed to find connection address');

		this.log('Connecting to upstream', address);
		this.upstream = await Relay.connect(address);

		this.upstream.onclose = () => {
			this.log('Upstream connection closed');
			this.upstream = undefined;
		};
	}

	async connect() {
		if (this.upstream) return;
		await this.connectUpstream();

		setTimeout(() => {
			this.syncMetadata();
		}, 100);
	}

	syncMetadata() {
		if (!this.upstream) return;

		this.log('Opening subscription to sync metadata');
		this.upstream.subscribe([{ kinds: [0, 10002, 12012, 39000, 39001, 39002] }], {
			// @ts-expect-error
			id: 'metadata-sync',
			onevent: (event) => this.eventStore.addEvent(event),
			onclose: () => {
				this.log('Closed metadata sync');
			},
		});
	}

	private syncChannelsFromFilters(filters: Filter[]) {
		const channels = new Set<string>();
		for (const filter of filters) {
			if (filter['#h']) filter['#h'].forEach((c) => channels.add(c));
		}
		for (const channel of channels) {
			this.syncChannel(channel);
		}
	}

	channelSubs = new Map<string, Subscription>();
	syncChannel(channel: string) {
		if (!this.upstream) return;
		if (this.channelSubs.has(channel)) return;

		this.log('Opening subscription to sync channel', channel);
		const sub = this.upstream.subscribe([{ kinds: [9, 10, 11, 12], '#h': [channel] }], {
			// @ts-expect-error
			id: `channel-${channel}-sync`,
			onevent: (event) => this.eventStore.addEvent(event),
			onclose: () => {
				this.channelSubs.delete(channel);
			},
		});

		this.channelSubs.set(channel, sub);
	}

	stop() {
		this.upstream?.close();
	}
}