# Measey

Simple easing for Cavalry. Adjust the **Power** slider and switch between **In**, **Out** and **Both** to find the right feel.

**Version:** 1.6.3 · **Cavalry target:** 2.7.2 or later

## Features

- **Power slider:** make easing softer or stronger with one control.
- **In / Out / Both:** quickly choose where the easing happens.
- **Optional fine-tuning:** adjust graph weights and midpoint, save presets or use custom expressions.

## Install

1. Download [`Measey.js`](https://github.com/markus-zeljak/measey/releases/latest/download/Measey.js).
2. In Cavalry, choose **Scripts → Show Scripts Folder**.
3. Copy `Measey.js` into that folder.
4. Open **Scripts → Measey**.

To update, replace the file, then close and reopen the panel.

**Scripts** may be under **Window** in some versions; **Show Scripts Folder** may also appear under **Help**. See [Cavalry's installation guide](https://cavalry.studio/docs/tech-info/scripting/script-uis/).

## Use

1. Select keyframes whose outgoing easing you want to change.
2. Choose **In**, **Out** or **Both**.
3. Move the **Power** slider to adjust the easing strength.
4. Click **Apply**.

For more control, adjust the graph's weight handles or the midpoint in Both.

> [!TIP]
> Enable **Apply on drag** and **Apply on direction** in Settings to apply changes automatically as you adjust Power or switch modes.

## Notes

- The Power slider uses whole numbers from 1–12; type a precise value of 1 or higher in its number field. Committing a typed number applies it immediately. **Power 1 clears Magic Easing** and sets the keyframes to Silver.
- Click a graph weight handle to type an exact value. Right-click empty graph space to reset weights.
- Live value and speed graphs show selected curves as overlays.
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
