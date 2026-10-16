# Development tools

Run from the repository root:

```sh
python3 -X utf8 tools/build.py
node tools/test.cjs
```

The build joins the four source modules into `Measey.js`. The test runner runs the numerical and mocked host/controller/UI checks. Python 3 and Node.js are required; no packages need installing. On Windows, use `python` if `python3` is unavailable.
