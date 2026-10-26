# Offline + live checks

Run with Node 18+ (DES test needs `--openssl-legacy-provider` on Node 17+):

```sh
node --openssl-legacy-provider tests/des_test.js   # pure-JS DES vs Node crypto
node tests/mock_logic.js                           # canned-response logic tests
node tests/host_sim.js                             # LIVE end-to-end via a host simulation
```

`host_sim.js` loads each extension exactly like a host app would (mocked
`http`/`storage`/`file`/`log` + `registerExtension` capture, sync-curl HTTP
bridge) and exercises search, metadata, download URLs and URL imports against
the real services. Paths that are bot-gated from datacenter IPs (YouTube
player, Spotify token endpoint) are covered by `mock_logic.js` instead — they
work from residential connections, i.e. real devices.
