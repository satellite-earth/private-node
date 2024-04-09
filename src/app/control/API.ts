import OS from 'os';

import * as Functions from '../functions/index.js';
import type Control from './index.js';
import { AppConfig } from '../config-manager.js';

const API = (control: Control) => {
	return {
		CLEAR_DATABASE: () => {
			Functions.ClearDatabase(control.app);

			control.log({
				text: `[control] DATABASE CLEARED`,
			});
		},

		EXPORT_DATABASE: async () => {
			let log;

			try {
				const t0 = Date.now();

				// KEEP WORKING . . . fix this hardcoded export path . . . make
				// a dialog in the ui that let's the user choose the export location

				await Functions.ExportDatabase(control.app, {
					filters: [{}],
					name: `events`,
					path: OS.homedir(),
				});

				log = `[control] DATABASE EXPORT SUCCEEDED IN ${Date.now() - t0} MS`;
			} catch (err) {
				console.log(err);
				log = '[control] DATABASE EXPORT FAILED';
			}

			control.log({ text: log });
		},

		SYNC: () => {
			// dispatch([{
			// 	type: 'config/set',
			// 	data: control.config
			// }, {
			// 	type: 'status/set',
			// 	data: {
			// 		...control.status,
			// 		synced: true
			// 	}
			// }]);

			// console.log('control.app', control.app);
			// console.log('control', control);

			control.broadcast([
				{
					type: 'config/set',
					data: control.app.config.config,
				},
				{
					type: 'status/set',
					data: {
						...control.status,
						synced: true,
					},
				},
			]);

			control.log({
				text: '[control] SATELLITE NODE CONNECTION ESTABLISHED',
			});
		},

		// Set node config and return updated props
		SET_CONFIG: (data: Partial<AppConfig>) => {
			control.setConfig(data);
		},

		RECEIVER_CONFIG: (data: Partial<AppConfig>) => {
			// Modify receiver config
			control.setConfig(data);

			// Restart the receiver is listening,
			// restart it to reflect new config
			if (control.status.listening) {
				Functions.StopReceiver(control.app);

				Functions.StartReceiver(control.app);
			}
		},

		RECEIVER_LISTEN: async () => {
			await Functions.StartReceiver(control.app);
		},

		RECEIVER_UNLISTEN: () => {
			Functions.StopReceiver(control.app);
		},
	};
};

export default API;
