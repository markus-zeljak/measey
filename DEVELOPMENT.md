# Development

`Measey.js` is the installable bundle; edit the four modules in `src/`.

```sh
python3 -X utf8 tools/build.py
node tools/test.cjs
node tests/performance.cjs --versions=current --quick
```

The build needs Python 3; checks need a current Node.js release. On Windows, use `python` if `python3` is unavailable. No packages need installing.

This published source passed syntax, numerical and mocked host/controller/UI checks. Repository preparation did not run it inside Cavalry. See [test notes](tests/README.md) for coverage and limitations.
