import { createConsumerHost, apps } from './shared/host.mjs';
const args = process.argv.slice(2), app = args[0];
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (!apps.includes(app)) { console.error('Usage: node validation-apps/start.mjs <' + apps.join('|') + '> [--port 4501] [--runtime http://127.0.0.1:4318]'); process.exitCode = 1; }
else {
  const port = Number(option('--port', 4501 + apps.indexOf(app)));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Choose a port between 1024 and 65535.');
  const host = createConsumerHost({ app, port, runtime: option('--runtime', 'http://127.0.0.1:4318') });
  console.log(`${app}: ${await host.listen()}\nKeep this consumer host and the independent Hermo runtime running. API keys stay in browser memory.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => host.server.close());
}
