# Measey

**Responsive easing for Cavalry.** Shape Magic Easing with weights and a Power slider, with a live graph to see the result.

## Features

- In, Both and Out easing with adjustable endpoint weights and midpoint.
- Value and speed graph previews, with selected curves shown as overlays.
- Custom Magic Expressions, saved presets and importable/exportable libraries.
- Clear Magic Easing or approximate it with Bézier keyframes using Flatten.

## Install

**Target:** Cavalry 2.7.2 or later. No build step or extra dependencies.

1. Download [Measey.js](https://github.com/markus-zeljak/measey/releases/latest/download/Measey.js).
2. In Cavalry, choose **Scripts → Show Scripts Folder**.
3. Copy `Measey.js` into that folder.
4. Open **Scripts → Measey**.

Close and reopen the panel after updating. See [Cavalry's installation guide](https://cavalry.studio/docs/tech-info/scripting/script-uis/).

## Quick start

1. Select keyframes whose outgoing easing you want to change.
2. Choose **In**, **Both** or **Out**.
3. Adjust **Power** and drag the graph's weight handles. Both also has a movable midpoint.
4. Click **Apply**.

The slider uses whole numbers from 1–12; type a precise value of 1 or higher in the number field. Committing a typed number applies it immediately. **Power 1 clears Magic Easing** and sets the keyframes to Silver.

Automatic application starts off. Enable **Apply on drag**, **Apply on direction** or **Apply on type** in Settings if wanted. Click a weight handle to enter a number; right-click empty graph space to reset weights.

## Limits

- The graph previews the first 10 selected keyframes. Apply, Clear and Flatten use the full selection.
- Flatten is a Bézier approximation and reports its fitting error.
- Expression previews support a subset of ExprTk syntax; loops, vectors, strings and user-defined functions are unsupported.
- This published source passed syntax, numerical and mocked host/controller/UI checks. This publication pass did not run it inside Cavalry.

## Development

`Measey.js` is the installable bundle; edit the four modules in `src/`.

```sh
python3 -X utf8 tools/build.py
node tools/test.cjs
node tests/performance.cjs --versions=current --quick
```

The build needs Python 3; checks need a current Node.js release. On Windows, use `python` if `python3` is unavailable. No packages need installing. See [test notes](tests/README.md) for the limits of the checks.

## Credits & authorship

Measey was inspired by [Easey](https://github.com/sammularczyk/easey) by **Sam Mularczyk**. It takes a different approach to the graph: weights and Power shape Magic Easing, or “responsive easing.” Easey's readable MIT source was consulted for UI and API patterns; see [third-party notices](THIRD_PARTY_NOTICES.md).

I did not write any of the code. All code was generated with OpenAI Codex from my prompts and feedback.

## Feedback

Found a bug? [Open an issue](https://github.com/markus-zeljak/measey/issues/new/choose) with your Cavalry version, operating system and steps to reproduce. Include a screenshot or a small scene when useful.

[MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
