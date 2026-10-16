# Test notes

Run from the repository root:

```sh
node tools/test.cjs
node tests/performance.cjs --versions=current --quick
node --check Measey.js
```

- `tools/test.cjs` runs numerical tests and mocked host, controller and UI checks. These passed when preparing version 1.6.3 for publication: 33 numerical groups, 23 adapter groups, 87 controller groups and the UI smoke suite.
- `performance.cjs` measures a simulated host/UI. Use `--versions=current`: its default also requests historical sources that are not included in this repository. Timings are not native Cavalry measurements.
- `native-host-test.js` and `native-host-extended.js` are preserved historical, self-contained Cavalry harnesses with embedded earlier source. They change test layers and use `/tmp` report paths. They are not part of the Node test command and do not verify the current adapter.

No native Cavalry test was run during publication. Check the current build in a disposable composition before relying on it for production work.
