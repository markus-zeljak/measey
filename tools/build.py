from pathlib import Path
root=Path(__file__).resolve().parents[1]
parts=['curve-math.js','measey-host.js','measey-ui.js','measey-main.js']
(root/'Measey.js').write_text('\n'.join((root/'src'/p).read_text() for p in parts))
print('Built Measey.js')
