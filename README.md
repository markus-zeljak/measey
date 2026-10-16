# Measey

Shape responsive Magic Easing in Cavalry with weights and a Power slider.

**Version:** 1.6.3 · **Cavalry target:** 2.7.2 or later

## Features

- In, Both and Out easing with adjustable weights and midpoint.
- Live value and speed graphs with selected curves as overlays.
- Custom expressions, saved presets and importable/exportable libraries.
- Clear Magic Easing or approximate it with Bézier keyframes using Flatten.

## Install

1. Download [`Measey.js`](https://github.com/markus-zeljak/measey/releases/latest/download/Measey.js).
2. In Cavalry, choose **Scripts → Show Scripts Folder**.
3. Copy `Measey.js` into that folder.
4. Open **Scripts → Measey**.

To update, replace the file, then close and reopen the panel.

**Scripts** may be under **Window** in some versions; **Show Scripts Folder** may also appear under **Help**. See [Cavalry's installation guide](https://cavalry.studio/docs/tech-info/scripting/script-uis/).

## Use

1. Select keyframes whose outgoing easing you want to change.
2. Choose **In**, **Both** or **Out**.
3. Adjust **Power** and drag the graph's weight handles.
4. Click **Apply**.

Both also has a movable midpoint. The Power slider uses whole numbers from 1–12; type a precise value of 1 or higher in its number field. Committing a typed number applies it immediately. **Power 1 clears Magic Easing** and sets the keyframes to Silver.

Automatic application starts off. Enable **Apply on drag**, **Apply on direction** or **Apply on type** in Settings if wanted.

> [!TIP]
> Click a weight handle to type an exact value. Right-click empty graph space to reset weights.

## Notes

- The graph previews the first 10 selected keyframes. Apply, Clear and Flatten use the full selection.
- Flatten is a Bézier approximation and reports its fitting error.
- Expression previews support a subset of ExprTk syntax; loops, vectors, strings and user-defined functions are unsupported.
- No extra software is required to use the script.
- Source, build commands and test coverage are documented in [Development](DEVELOPMENT.md).

## Credits

I did not write any of the code. All code was generated with OpenAI Codex from my prompts and feedback.

Measey was inspired by [Easey](https://github.com/sammularczyk/easey) by **Sam Mularczyk**. It takes a different approach to the graph: weights and Power shape Magic Easing, or “responsive easing.” Easey's readable MIT source was consulted for UI and API patterns; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Feedback

Found a problem? [Open an issue](https://github.com/markus-zeljak/measey/issues/new?template=bug_report.yml) with your tool version, Cavalry version, operating system and steps to reproduce.

## License

[MIT](LICENSE). Free to use, modify and share.
