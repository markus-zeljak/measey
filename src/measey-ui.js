/* Measey native panel. Original implementation; no external assets or modules. */
function buildMeaseyUI(controller, math) {
    var closed = false, syncing = false, resizing = false;
    var width = 380, sliderWidth = 380, dividerWidth = 380, graphHeight = 210;
    var controlHeight = 28, groupPadding = 3, powerEditing = false, lastWidthLimit = null;
    var lastPresetKey = null, lastThemeKey = null, presetRefs = [];
    var localMode = "value", drag = null, dividerHover = false, guideHover = false, guideDrag = null;
    var endpointHover = null, endpointDrag = null, sliderDragging = false, weightEditor = null, buttons = [];
    var stateSnapshot = null, compiledCache = cache(128), sampleCache = cache(256), pathCache = cache(192);
    var selectionCache = {source:null, key:null, curves:[], value:null, speed:null}, graphScene = null;
    var functionRefs = [], functionSerial = 0;
    ui.setMargins(0, 0, 0, 0);
    ui.setSpaceBetween(0);
    var main = new ui.VLayout();
    main.setMargins(8, 8, 8, 8);
    main.setSpaceBetween(12);

    function state() { return stateSnapshot || (stateSnapshot = controller.getState() || {}); }
    function cache(limit) {
        var values = Object.create(null), order = [];
        return {
            get:function(key) {
                if (!Object.prototype.hasOwnProperty.call(values, key)) return null;
                var index = order.indexOf(key); if (index >= 0) order.splice(index, 1);
                order.push(key); return values[key];
            },
            put:function(key, value) {
                if (Object.prototype.hasOwnProperty.call(values, key)) order.splice(order.indexOf(key), 1);
                values[key] = value; order.push(key);
                if (order.length > limit) delete values[order.shift()];
                return value;
            },
            clear:function() { values = Object.create(null); order = []; }
        };
    }
    function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }
    function blend(a, b, amount) {
        function channel(s, i) { return parseInt(String(s).replace("#", "").substr(i * 2, 2), 16) || 0; }
        var out = "#";
        for (var i = 0; i < 3; i++) {
            var n = Math.round(channel(a, i) * (1 - amount) + channel(b, i) * amount);
            out += (n < 16 ? "0" : "") + n.toString(16);
        }
        return out;
    }
    function themeColor(key, fallback) {
        try {
            var color = ui.getThemeColor(key);
            return typeof color === "string" && /^#[0-9a-f]{6}/i.test(color) ? color.substr(0, 7) : fallback;
        } catch (e) { return fallback; }
    }
    function colors() {
        var bg = themeColor("Base", "#373737"), text = themeColor("Text", "#ececec");
        return {
            bg: bg, text: text, muted: blend(text, bg, 0.43),
            surface: blend(bg, "#000000", 0.28), raised: blend(bg, text, 0.07),
            grid: "#434343", accent: "#c58bd0",
            selected: blend(bg, "#b486bb", 0.29)
        };
    }
    function call(name, args) {
        if (closed) return;
        if (typeof controller[name] === "function") controller[name].apply(controller, args || []);
        refresh();
    }
    function label(text, size) {
        var widget = new ui.Label(text);
        widget.setFontSize(size || 11);
        return widget;
    }
    function button(text, tooltip, callback, minWidth) {
        var widget = new ui.Button(text);
        widget.setFontSize(12);
        widget.setFixedHeight(controlHeight);
        widget.setCornerRounding(3);
        widget.setContentsMargins(0, 0, 0, 0);
        if (typeof widget.setDrawStroke === "function") widget.setDrawStroke(false);
        if (minWidth) widget.setMinimumWidth(minWidth);
        widget.setToolTip(tooltip);
        widget.onClick = callback;
        buttons.push(widget);
        return widget;
    }
    function group(layout) {
        layout.setMargins(groupPadding, groupPadding, groupPadding, groupPadding);
        layout.setSpaceBetween(3);
        var host = new ui.Container();
        host.setLayout(layout); host.setRadius(5, 5, 5, 5);
        host.setFixedHeight(controlHeight + groupPadding * 2);
        return host;
    }
    function field(widget) {
        widget.setFontSize(13); widget.setFixedHeight(controlHeight);
        widget.setContentsMargins(0, 0, 0, 0);
        widget.setCornerRounding(3);
        widget.setMinimumWidth(1);
        // LineEdit keeps its native rectangular frame on 2.7.2. Matching its
        // surface to a rounded host provides corners and real text padding.
        var row = new ui.HLayout();
        row.setMargins(6, 0, 6, 0); row.setSpaceBetween(0); row.add(widget);
        var host = new ui.Container();
        host.setLayout(row); host.setRadius(3, 3, 3, 3); host.setFixedHeight(controlHeight);
        return {editor:widget, host:host};
    }
    function stroke(canvas, path, color, thickness) {
        canvas.addPath(path.toObject(), { color: color, stroke: true, strokeWidth: thickness || 1 });
    }
    function line(canvas, x1, y1, x2, y2, color, thickness) {
        var path = new cavalry.Path();
        path.moveTo(x1, y1); path.lineTo(x2, y2);
        stroke(canvas, path, color, thickness);
    }
    function expressionFunction(expression) {
        var source = String(expression || "x"), saved = compiledCache.get(source);
        if (saved) { if (saved.error) throw saved.error; return saved.fn; }
        try {
            var compiled = math.compile(source), fn;
            if (typeof compiled === "function") fn = compiled;
            else if (compiled && typeof compiled.evaluate === "function") fn = function(t) { return compiled.evaluate(t); };
            else if (compiled && typeof compiled.value === "function") fn = function(t) { return compiled.value(t); };
            else if (compiled && typeof compiled.fn === "function") fn = compiled.fn;
            else throw new Error("Expression cannot be previewed");
            compiledCache.put(source, {fn:fn}); return fn;
        } catch (error) { compiledCache.put(source, {error:error}); throw error; }
    }
    function curveSignature(curve) {
        if (typeof curve === "string") return "expression:" + curve;
        if (curve && typeof curve.evaluate === "function") {
            for (var i = 0; i < functionRefs.length; i++) if (functionRefs[i].fn === curve.evaluate) return "function:" + functionRefs[i].id;
            var ref = {fn:curve.evaluate, id:++functionSerial}; functionRefs.push(ref);
            if (functionRefs.length > 128) functionRefs.shift();
            return "function:" + ref.id;
        }
        if (curve && curve.samples && curve.samples.length > 1) return "samples:" + JSON.stringify(curve.samples);
        if (curve && curve.bezier) {
            var b = curve.bezier;
            return "bezier:" + JSON.stringify(Array.isArray(b) ? b : [b.x1, b.y1, b.x2, b.y2]);
        }
        return "expression:" + (curve && curve.expression || "x");
    }
    function curveFunction(curve) {
        if (typeof curve === "string") return expressionFunction(curve);
        if (curve && typeof curve.evaluate === "function") return curve.evaluate;
        if (curve && curve.samples && curve.samples.length > 1) {
            var points = curve.samples;
            return function(t) {
                if (t <= points[0].x) return points[0].y;
                if (t >= points[points.length - 1].x) return points[points.length - 1].y;
                var low = 1, high = points.length - 1;
                while (low < high) {
                    var middle = Math.floor((low + high) / 2);
                    if (points[middle].x < t) low = middle + 1; else high = middle;
                }
                var span = points[low].x - points[low - 1].x;
                if (span <= 0) return points[low].y;
                var amount = (t - points[low - 1].x) / span;
                return points[low - 1].y + (points[low].y - points[low - 1].y) * amount;
            };
        }
        if (curve && curve.bezier) {
            var bezier = curve.bezier;
            if (Array.isArray(bezier)) bezier = { x1: bezier[0], y1: bezier[1], x2: bezier[2], y2: bezier[3] };
            return function(t) { return math.bezierValue(t, bezier); };
        }
        return expressionFunction(curve && curve.expression || "x");
    }
    function samples(fn, count, speed) {
        var out = [], eps = 0.0005;
        for (var i = 0; i <= count; i++) {
            var t = i / count, y;
            if (speed) {
                var lo = Math.max(0, t - eps), hi = Math.min(1, t + eps);
                y = (fn(hi) - fn(lo)) / (hi - lo);
            } else y = fn(t);
            if (typeof y !== "number" || !isFinite(y)) throw new Error("Non-finite curve");
            out.push({ t: t, y: y });
        }
        return out;
    }
    function cachedSamples(curve, count, speed, signature) {
        var key = (speed ? "speed:" : "value:") + count + ":" + (signature || curveSignature(curve));
        var saved = sampleCache.get(key); if (saved) return saved;
        try {
            var values = samples(curveFunction(curve), count, speed), low = 0, high = 1, ordinates = [];
            for (var i = 0; i < values.length; i++) {
                low = Math.min(low, values[i].y); high = Math.max(high, values[i].y); ordinates.push(values[i].y);
            }
            return sampleCache.put(key, {values:values, low:low, high:high, geometry:count + ":" + JSON.stringify(ordinates)});
        } catch (error) { return sampleCache.put(key, {error:error}); }
    }
    function selectionSamples(curves, speed) {
        if (selectionCache.source !== curves) {
            var unique = [], signatures = [], seen = Object.create(null);
            for (var i = 0; i < curves.length; i++) {
                var signature = curveSignature(curves[i]);
                if (seen[signature]) continue;
                seen[signature] = true; unique.push(curves[i]); signatures.push(signature);
            }
            var key = JSON.stringify(signatures);
            if (key !== selectionCache.key) {
                selectionCache = {source:curves, key:key, curves:unique, signatures:signatures, value:null, speed:null};
            } else selectionCache.source = curves;
        }
        var modeKey = speed ? "speed" : "value";
        if (selectionCache[modeKey]) return selectionCache[modeKey];
        var out = [], geometries = Object.create(null);
        for (var j = 0; j < selectionCache.curves.length; j++) {
            var data = cachedSamples(selectionCache.curves[j], 150, speed, selectionCache.signatures[j]);
            if (data.error || geometries[data.geometry]) continue;
            geometries[data.geometry] = true; out.push(data);
        }
        selectionCache[modeKey] = out; return out;
    }
    function samplePath(values, box, low, high, geometry) {
        var key = (geometry || JSON.stringify(values)) + ":" + [box.x, box.y, box.w, box.h, low, high].join(",");
        var saved = pathCache.get(key); if (saved) return saved;
        var path = new cavalry.Path(), range = Math.max(0.00001, high - low);
        for (var i = 0; i < values.length; i++) {
            var x = box.x + values[i].t * box.w;
            var y = box.y + (values[i].y - low) / range * box.h;
            if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        return pathCache.put(key, path.toObject());
    }
    function drawSamples(canvas, values, box, low, high, color, thickness, geometry) {
        canvas.addPath(samplePath(values, box, low, high, geometry), {color:color, stroke:true, strokeWidth:thickness || 1});
    }

    var tabs = new ui.HLayout();
    tabs.setMargins(0, 0, 0, 0); tabs.setSpaceBetween(3);
    var valueButton = button("Value", "Preview the normalized easing curve", function() { setMode("value"); });
    var speedButton = button("Speed", "Preview the change in value over time", function() { setMode("speed"); });
    tabs.add(valueButton, speedButton);
    var tabGroup = group(tabs);

    var graph = new ui.Draw();
    graph.setSize(width, graphHeight);
    graph.setMinimumWidth(160);
    graph.setTransparentForMouseEvents(true);
    graph.setToolTip("Curve preview follows the selected keyframes. Drag the divider below to resize.");
    var graphRow = new ui.HLayout();
    graphRow.setMargins(0, 0, 0, 0); graphRow.setSpaceBetween(0); graphRow.add(graph);
    var graphHost = new ui.Container();
    graphHost.setLayout(graphRow);
    graphHost.setFixedHeight(graphHeight);
    graphHost.useHoverEvents(true);
    var dividerCanvas = new ui.Draw();
    dividerCanvas.setSize(width, 9);
    dividerCanvas.setTransparentForMouseEvents(true);
    var dividerRow = new ui.HLayout();
    dividerRow.setMargins(0, 0, 0, 0); dividerRow.setSpaceBetween(0); dividerRow.add(dividerCanvas);
    var divider = new ui.Container();
    divider.setLayout(dividerRow); divider.setFixedHeight(9);
    divider.useHoverEvents(true);
    divider.setToolTip("Drag to resize the curve preview. Double-click to reset.");

    var inputField = field(new ui.LineEdit()), input = inputField.editor;
    input.setMinimumWidth(55);
    input.setPlaceholder("Magic expression, e.g. x^3");
    input.setToolTip("Use x from 0 to 1 (t is also accepted). Apply with the checkmark, or turn on Apply on type in Settings.");
    input.onValueChanged = function() {
        if (!syncing && !closed) call("editExpression", [input.getText(), false]);
    };
    input.onValueCommitted = function() {
        if (!syncing && !closed) call("editExpression", [input.getText(), true]);
    };
    var getButton = button("→", "Get the selected keyframes' expression into the custom field", function() { call("getSelection"); });
    getButton.setFixedWidth(controlHeight);
    var applyButton = button("✓", "Apply the custom expression to the selected keyframes", function() { call("apply"); });
    applyButton.setFixedWidth(controlHeight);
    var settingsButton = button("⚙", "Measey settings", function() { call("showSettings"); });
    settingsButton.setFixedWidth(controlHeight);
    var inputRow = new ui.HLayout();
    inputRow.setMargins(0, 0, 0, 0); inputRow.setSpaceBetween(4);
    inputRow.add(getButton, inputField.host, applyButton, settingsButton);
    var inputGroup = group(inputRow);
    main.add(tabGroup);
    // Keep the graph, handle and Power section's existing six-pixel rhythm.
    var graphBlock = new ui.VLayout();
    graphBlock.setMargins(0, 0, 0, 0); graphBlock.setSpaceBetween(6);
    graphBlock.add(graphHost, divider);

    var directions = ["in", "in out", "out"], directionCaptions = ["In", "Both", "Out"];
    // Cavalry 2.7.2 does not expose the SegmentedControl in newer docs.
    // Native Buttons keep the direction strip keyboard accessible on 2.7.2.
    var directionRow = new ui.HLayout(), directionButtons = [];
    directionRow.setMargins(0, 0, 0, 0); directionRow.setSpaceBetween(3);
    directions.forEach(function(direction, index) {
        var control = button(directionCaptions[index], "Preview " + directionCaptions[index] + " Power easing. Apply on direction can be enabled in Settings.", function() {
            call("setDirection", [direction]);
        });
        directionButtons.push(control); directionRow.add(control);
    });
    var directionGroup = group(directionRow);

    var powerRow = new ui.HLayout();
    powerRow.setMargins(0, 0, 0, 0); powerRow.setSpaceBetween(6);
    var powerLabel = label("POWER", 12);
    var headingWidth = 54, headingGap = 12;
    powerLabel.setFixedWidth(headingWidth);
    var selectedPowerLabel = label("", 11);
    selectedPowerLabel.setMinimumWidth(0);
    var numericField = field(new ui.LineEdit()), powerField = numericField.editor;
    numericField.host.setFixedWidth(76);
    powerField.setToolTip("Power 1 or above. Type precise values using . or ,; the slider uses whole numbers from 1 to 12.");
    var powerSliderCanvas = new ui.Draw();
    var sliderHeight = controlHeight + groupPadding * 2;
    powerSliderCanvas.setSize(sliderWidth, sliderHeight); powerSliderCanvas.setTransparentForMouseEvents(true);
    var sliderRow = new ui.HLayout();
    sliderRow.setMargins(0, 0, 0, 0); sliderRow.setSpaceBetween(0); sliderRow.add(powerSliderCanvas);
    var powerSlider = new ui.Container();
    powerSlider.setLayout(sliderRow); powerSlider.setFixedHeight(sliderHeight); powerSlider.useHoverEvents(true);
    powerSlider.setToolTip("Drag Power from 1 to 12. The numeric field also accepts keyboard entry.");
    powerField.onValueChanged = function() {
        if (!syncing && !closed) powerEditing = true;
    };
    powerField.onValueCommitted = function() {
        if (syncing || closed) return;
        var entered = powerField.getText();
        powerEditing = false;
        call("setPower", [entered, true, "numeric"]);
    };
    powerRow.setSpaceBetween(headingGap);
    powerRow.add(powerLabel, selectedPowerLabel); powerRow.addStretch(); powerRow.add(numericField.host);
    var powerBlock = new ui.VLayout();
    powerBlock.setMargins(0, 0, 0, 0); powerBlock.setSpaceBetween(6);
    powerBlock.add(powerRow, powerSlider);
    main.add(graphBlock);
    main.add(inputGroup);
    main.add(powerBlock);
    main.add(directionGroup);

    var actionRow = new ui.HLayout();
    actionRow.setMargins(0, 0, 0, 0); actionRow.setSpaceBetween(6);
    var applyPowerLabel = label("Apply", 12);
    applyPowerLabel.setAlignment(1); applyPowerLabel.setTransparentForMouseEvents(true);
    var applyPowerRow = new ui.HLayout();
    applyPowerRow.setMargins(6, 0, 6, 0); applyPowerRow.add(applyPowerLabel);
    var applyPowerButton = new ui.Container();
    applyPowerButton.setLayout(applyPowerRow); applyPowerButton.setRadius(3, 3, 3, 3);
    applyPowerButton.setFixedHeight(controlHeight); applyPowerButton.setMinimumWidth(40);
    applyPowerButton.onMouseRelease = function(position, buttonName) {
        if (buttonName === "left" && state().canApplyPower !== false) call("applyPower");
    };
    buttons.push(applyPowerButton);
    var flattenButton = button("≈", "Flatten selected magic expressions to Bézier keyframes and set their color to Silver", function() { call("flatten"); });
    var clearButton = button("×", "Clear selected magic expressions and set their color to Silver", function() { call("clear"); });
    flattenButton.setFixedWidth(28); clearButton.setFixedWidth(28);
    actionRow.add(applyPowerButton, flattenButton, clearButton);
    var actionGroup = group(actionRow);
    main.add(actionGroup);

    var presetHeader = new ui.HLayout();
    presetHeader.setMargins(0, 4, 0, 0);
    var presetTitle = label("LIBRARY", 11), libraryNameLabel = label("", 11);
    presetTitle.setFixedWidth(headingWidth);
    presetHeader.setSpaceBetween(headingGap);
    var libraryButton = button("⋯", "Library settings", function() { call("showLibrarySettings"); });
    libraryButton.setFixedWidth(28);
    presetTitle.setFixedHeight(18);
    presetHeader.add(presetTitle, libraryNameLabel); presetHeader.addStretch(); presetHeader.add(libraryButton);
    main.add(presetHeader);
    var presetLayout = new ui.VLayout();
    presetLayout.setMargins(0, 0, 0, 0); presetLayout.setSpaceBetween(5);
    main.add(presetLayout);
    main.addStretch();
    var outerScroll = new ui.ScrollView();
    outerScroll.setLayout(main);
    ui.add(outerScroll);
    ui.setMinimumWidth(220);
    ui.setMinimumHeight(260);

    function refreshPresetHeader() {
        var fullName = String(state().libraryName || "None");
        var titleWidth = Math.max(20, width - headingWidth - headingGap * 3 - 28);
        var maxCharacters = Math.max(8, Math.floor(titleWidth / 6.4));
        var displayName = fullName;
        if (displayName.length > maxCharacters) displayName = displayName.slice(0, maxCharacters - 1) + "…";
        libraryNameLabel.setFixedWidth(titleWidth);
        libraryNameLabel.setText(displayName);
        libraryNameLabel.setToolTip(fullName);
        var powers = (state().selectedPowerLevels || []).join(", ");
        var levelWidth = Math.max(0, width - headingWidth - headingGap * 3 - 76);
        var levelCharacters = Math.max(1, Math.floor(levelWidth / 6.4));
        selectedPowerLabel.setFixedWidth(levelWidth);
        selectedPowerLabel.setText(powers.length > levelCharacters ? powers.slice(0, Math.max(0, levelCharacters - 1)) + "…" : powers);
        selectedPowerLabel.setToolTip(powers);
    }

    function setMode(mode) {
        if (closed) return;
        localMode = mode;
        if (typeof controller.savePreferences === "function") controller.savePreferences({ mode: mode });
        refresh();
    }
    function mode() { return state().mode || localMode; }
    function bothMidpoint() {
        var value = Number(state().bothMidpoint);
        return isFinite(value) && value >= 0.01 && value <= 0.99 ? value : 0.5;
    }
    function powerSelected() { return state().powerSelected !== false; }
    function plotBox() { return {x:1.5, y:2, w:Math.max(80, width - 3), h:Math.max(65, graphHeight - 4)}; }
    function guideX() { return 1.5 + bothMidpoint() * Math.max(80, width - 3); }
    function graphLocalX(position) {
        if (!position) return null;
        var x = Number(position.x);
        if (!isFinite(x)) return null;
        try {
            var host = graphHost.geometry(), canvas = graph.geometry();
            var offset = Number(canvas.left) - Number(host.left);
            if (isFinite(offset)) x -= offset;
        } catch (e) {}
        return x;
    }
    function guideHit(position) {
        var x = graphLocalX(position), y = position ? Number(position.y) : NaN, box = plotBox();
        return powerSelected() && state().direction === "in out" && x !== null && isFinite(y) &&
            y >= box.y && y <= box.y + box.h && Math.abs(x - guideX()) <= 7;
    }
    function endpointActive(side) {
        var direction = state().direction || "out";
        return powerSelected() && (direction === "in out" || direction === (side === "bottom" ? "in" : "out"));
    }
    function endpointValue(side) {
        var value = Number(state()[side]);
        return isFinite(value) ? clamp(value, 0, 1) : 0;
    }
    function endpointBounds(side, pressed) {
        var box = plotBox(), span = box.h / 2 - 14;
        // Native graph mouse positions use Y-up coordinates. Each endpoint
        // occupies its own half, with a twelve-pixel gap at the maximum.
        var y = side === "bottom" ? box.y + 8 + endpointValue(side) * span : box.y + box.h - 8 - endpointValue(side) * span;
        return {x:box.x + (pressed ? 0 : 6), y:y - 1.5, w:box.w - (pressed ? 0 : 12), h:3, centreY:y, span:span};
    }
    function endpointHit(position) {
        if (!position) return null;
        var x = graphLocalX(position), y = Number(position.y), box = plotBox();
        if (x === null || !isFinite(y)) return null;
        var sides = ["bottom", "top"];
        for (var i = 0; i < sides.length; i++) {
            if (!endpointActive(sides[i])) continue;
            var bounds = endpointBounds(sides[i], false);
            // Preserve a central click target for the midpoint guide even
            // when both endpoint handles are at their maximum values.
            if (sides[i] === "bottom" ? y > box.y + box.h / 2 - 2 : y < box.y + box.h / 2 + 2) continue;
            if (x >= bounds.x - 4 && x <= bounds.x + bounds.w + 4 && Math.abs(y - bounds.centreY) <= 7) return sides[i];
        }
        return null;
    }
    function handleColor(c, pressed, hovered) {
        return pressed ? c.accent : hovered ? c.selected : "#434343";
    }
    function weightActive(kind) {
        return kind === "midpoint" ? powerSelected() && state().direction === "in out" :
            (kind === "bottom" || kind === "top") && endpointActive(kind);
    }
    function drawGraph() {
        var s = state(), c = colors(), speed = mode() === "speed";
        graph.clearPaths(); graph.setBackgroundColor(c.bg);
        var box = plotBox();
        var selected = selectionSamples(s.selectionPreviewCurves || [], speed);
        var currentExpression = s.powerExpression || (powerSelected() ? math.powerExpression(Number(s.power) || 4, s.direction || "out", bothMidpoint(), endpointValue("bottom"), endpointValue("top")) : "");
        var power = currentExpression ? cachedSamples(currentExpression, 150, speed) : null;
        if (power && power.error) power = null;
        if (!graphScene || graphScene.selected !== selected || graphScene.power !== power || graphScene.width !== width || graphScene.height !== graphHeight) {
            var low = 0, high = 1, paths = [];
            for (var i = 0; i < selected.length; i++) { low = Math.min(low, selected[i].low); high = Math.max(high, selected[i].high); }
            if (power) { low = Math.min(low, power.low); high = Math.max(high, power.high); }
            if (speed) {
                high = Math.max(1, high * 1.05);
                if (low < 0) low *= 1.05;
            } else if (low < 0 || high > 1) {
                var pad = (high - low) * 0.05; low -= pad; high += pad;
            }
            // Keep every unique selected shape. If Power has the same shape,
            // its accent path replaces the coincident grey path underneath.
            for (var j = 0; j < selected.length; j++) {
                if (!power || power.geometry !== selected[j].geometry) paths.push({path:samplePath(selected[j].values, box, low, high, selected[j].geometry), power:false});
            }
            if (power) paths.push({path:samplePath(power.values, box, low, high, power.geometry), power:true});
            // One active scene retains all its paths; historical caches have
            // fixed limits. Hover changes only handles and their value labels.
            graphScene = {selected:selected, power:power, width:width, height:graphHeight, paths:paths};
        }
        for (var grid = 0; grid <= 5; grid++) {
            var ratio = grid / 5;
            line(graph, box.x + ratio * box.w, box.y, box.x + ratio * box.w, box.y + box.h, c.grid);
            line(graph, box.x, box.y + ratio * box.h, box.x + box.w, box.y + ratio * box.h, c.grid);
        }
        var weightLabels = [];
        function weightLabel(value, x, y, rightAligned) {
            var path = new cavalry.Path();
            path.addText(String(value), 10, 0, 0);
            var textWidth = path.boundingBox().width;
            path.translate(clamp(rightAligned ? x - textWidth : x, box.x + 3, box.x + box.w - textWidth - 3),
                clamp(y, box.y + 3, box.y + box.h - 12));
            weightLabels.push(path);
        }
        ["bottom", "top"].forEach(function(side) {
            if (!endpointActive(side)) return;
            var pressed = endpointDrag && endpointDrag.side === side, bounds = endpointBounds(side, pressed);
            graph.addPath(roundedPath(bounds.x, bounds.y, bounds.w, bounds.h, 1.5).toObject(), {color:handleColor(c, pressed, endpointHover === side)});
            if (pressed || endpointHover === side) {
                if (side === "bottom") weightLabel(endpointValue(side), box.x + box.w - 6, bounds.centreY + 6, true);
                else weightLabel(endpointValue(side), box.x + 6, bounds.centreY - 14, false);
            }
        });
        if (powerSelected() && s.direction === "in out") {
            // Grow only along Y, above the grid and within the plot.
            var inset = guideDrag ? 0 : 6, left = guideX() - 1.5;
            var bottom = box.y + inset, top = box.y + box.h - inset;
            var guidePath = new cavalry.Path();
            guidePath.moveTo(left, bottom); guidePath.lineTo(left + 3, bottom);
            guidePath.lineTo(left + 3, top); guidePath.lineTo(left, top); guidePath.close();
            graph.addPath(guidePath.toObject(), {color:handleColor(c, guideDrag, guideHover)});
            if (guideDrag || guideHover) weightLabel(bothMidpoint(), guideX() + 6, box.y + box.h / 2, false);
        }
        for (var k = 0; k < graphScene.paths.length; k++) {
            var curve = graphScene.paths[k];
            graph.addPath(curve.path, {color:curve.power ? c.accent : c.muted, stroke:true, strokeWidth:curve.power ? 2.3 : 1.3});
        }
        for (var text = 0; text < weightLabels.length; text++) graph.addPath(weightLabels[text].toObject(), {color:c.muted, stroke:false});
        graph.redraw();
    }
    function drawDivider() {
        var c = colors();
        dividerCanvas.clearPaths(); divider.setBackgroundColor(c.bg); dividerCanvas.setBackgroundColor(c.bg);
        var length = drag ? 78 : 54, thickness = 3;
        dividerCanvas.addPath(roundedPath(Math.max(0, (dividerWidth - length) / 2), (9 - thickness) / 2, length, thickness, thickness / 2).toObject(), {color:handleColor(c, drag, dividerHover)});
        dividerCanvas.redraw();
    }
    function roundedPath(x, y, w, h, radius) {
        var p = new cavalry.Path(), r = Math.max(0, Math.min(radius, w / 2, h / 2)), k = r * 0.55228475;
        p.moveTo(x + r, y); p.lineTo(x + w - r, y);
        p.cubicTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
        p.lineTo(x + w, y + h - r);
        p.cubicTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
        p.lineTo(x + r, y + h);
        p.cubicTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
        p.lineTo(x, y + r); p.cubicTo(x, y + r - k, x + r - k, y, x + r, y); p.close();
        return p;
    }
    function maxPower() { return Math.max(1.1, Number(state().maxPower) || 12); }
    function allocatedWidth(host, fallback) {
        try {
            var bounds = host.geometry(), measured = Number(bounds.width);
            if (isFinite(measured) && measured > 0) return Math.floor(measured);
        } catch (e) {}
        return fallback;
    }
    function syncCanvasWidths() {
        // A Draw can be centered within its stretchable Container. Measure the
        // allocated row, including scrollbar space, rather than the window.
        var dimensions = ui.size(), rootWidth = Number(dimensions.width === undefined ? dimensions.x : dimensions.width);
        var limit = Math.max(160, isFinite(rootWidth) && rootWidth > 0 ? Math.floor(rootWidth - 16) : width);
        if (limit !== lastWidthLimit) {
            lastWidthLimit = limit;
            graphHost.setMaximumWidth(limit); powerSlider.setMaximumWidth(limit); divider.setMaximumWidth(limit);
        }
        var graphWidth = Math.min(limit, allocatedWidth(graphHost, limit));
        var trackWidth = Math.min(limit, allocatedWidth(powerSlider, graphWidth));
        var handleWidth = Math.min(limit, allocatedWidth(divider, graphWidth));
        var changed = graphWidth !== width || trackWidth !== sliderWidth || handleWidth !== dividerWidth;
        if (graphWidth !== width) { width = graphWidth; graph.setSize(width, graphHeight); graph.setMinimumWidth(160); }
        if (trackWidth !== sliderWidth) { sliderWidth = trackWidth; powerSliderCanvas.setSize(sliderWidth, sliderHeight); powerSliderCanvas.setMinimumWidth(0); }
        if (handleWidth !== dividerWidth) { dividerWidth = handleWidth; dividerCanvas.setSize(dividerWidth, 9); dividerCanvas.setMinimumWidth(0); }
        return changed;
    }
    function sliderMarker(value) {
        return 7.5 + (clamp(value, 1, maxPower()) - 1) / (maxPower() - 1) * Math.max(1, sliderWidth - 15);
    }
    function drawPowerSlider() {
        var c = colors(), value = clamp(Number(state().power) || 4, 1, maxPower());
        var marker = sliderMarker(value);
        powerSliderCanvas.clearPaths(); powerSliderCanvas.setBackgroundColor(c.bg);
        powerSliderCanvas.addPath(roundedPath(0, 0, sliderWidth, sliderHeight, 5).toObject(), {color:c.raised});
        if (powerSelected()) powerSliderCanvas.addPath(roundedPath(3, 3, marker + 1.5, sliderHeight - 6, 3).toObject(), {color:c.selected});
        // Centered step marks share the handle's exact x mapping, below it.
        for (var step = 1; step <= maxPower(); step++) {
            powerSliderCanvas.addPath(roundedPath(sliderMarker(step) - 1, sliderHeight / 2 - 3, 2, 6, 0).toObject(), {color:"#373737"});
        }
        if (powerSelected()) powerSliderCanvas.addPath(roundedPath(marker - 1.5, 6, 3, sliderHeight - 12, 1.5).toObject(), {color:c.accent});
        powerSliderCanvas.redraw();
    }
    function sliderPosition(position, committed) {
        if (closed || !position || !isFinite(position.x)) return;
        syncCanvasWidths();
        var ratio = clamp((position.x - 7.5) / Math.max(1, sliderWidth - 15), 0, 1);
        var value = Math.round(1 + ratio * (maxPower() - 1));
        powerEditing = false;
        if (!powerSelected() || committed || value !== Number(state().power)) call("setPower", [value, committed, "slider"]);
    }
    powerSlider.onMousePress = function(position, buttonName) {
        if (closed || buttonName !== "left") return;
        sliderDragging = true; sliderPosition(position, false);
    };
    powerSlider.onMouseMove = function(position) {
        if (sliderDragging) sliderPosition(position, false);
    };
    powerSlider.onMouseRelease = function(position, buttonName) {
        if (!sliderDragging) return;
        sliderDragging = false;
        if (buttonName === undefined || buttonName === "left") {
            if (position && isFinite(position.x)) sliderPosition(position, true);
            else call("setPower", [Math.round(Number(state().power)), true, "slider"]);
        }
    };
    function moveGuide(position, committed) {
        var x = graphLocalX(position);
        if (!guideDrag || x === null || state().direction !== "in out") return;
        if (!guideDrag.moved && Math.abs(x - guideDrag.startX) >= 3) guideDrag.moved = true;
        if (!guideDrag.moved) return;
        var value = clamp(Math.round((x - guideDrag.offset - 1.5) / Math.max(80, width - 3) * 100) / 100, 0.01, 0.99);
        if (committed || value !== bothMidpoint()) call("setBothMidpoint", [value, committed, "drag"]);
    }
    function moveEndpoint(position, committed) {
        if (!position) return;
        var y = Number(position.y);
        if (!endpointDrag || !isFinite(y) || !endpointActive(endpointDrag.side)) return;
        if (!endpointDrag.moved && Math.abs(y - endpointDrag.startY) >= 2) endpointDrag.moved = true;
        if (!endpointDrag.moved) return;
        var side = endpointDrag.side, box = plotBox(), bounds = endpointBounds(side, true);
        var target = y - endpointDrag.offset;
        var amount = side === "bottom" ? target - box.y - 8 : box.y + box.h - 8 - target;
        var value = clamp(Math.round(amount / bounds.span * 100) / 100, 0, 1);
        if (committed || value !== endpointValue(side)) call("setEndpoint", [side, value, committed, "drag"]);
    }
    function updateGraphHover(position) {
        endpointHover = endpointHit(position);
        guideHover = !endpointHover && guideHit(position);
    }
    graphHost.onMousePress = function(position, buttonName) {
        if (closed) return;
        syncCanvasWidths();
        var side = endpointHit(position);
        if (side) {
            guideDrag = null; guideHover = false;
            if (buttonName === "right") {
                endpointDrag = null; call("setEndpoint", [side, 0, true, "numeric"]);
                updateGraphHover(position); drawGraph();
            } else if (buttonName === "left") {
                var bounds = endpointBounds(side, false);
                endpointDrag = {side:side, startY:Number(position.y), offset:Number(position.y) - bounds.centreY, moved:false};
                endpointHover = side; drawGraph();
            }
            return;
        }
        if (!guideHit(position)) {
            if (buttonName === "right") {
                endpointDrag = null; guideDrag = null; endpointHover = null; guideHover = false;
                if (weightEditor) weightEditor.dismiss();
                drawGraph();
                ui.clearContextMenu();
                ui.addMenuItem({name:"Reset Weights", onMouseRelease:function() { call("resetWeights"); }});
                ui.showContextMenu();
            }
            return;
        }
        if (buttonName === "right") {
            endpointDrag = null; endpointHover = null; guideDrag = null;
            call("setBothMidpoint", [0.5, true, "numeric"]);
            if (!closed) { guideHover = guideHit(position); drawGraph(); }
            return;
        }
        if (buttonName !== "left") return;
        syncCanvasWidths();
        var x = graphLocalX(position);
        endpointDrag = null; endpointHover = null;
        guideDrag = {startX:x, offset:x - guideX(), moved:false};
        guideHover = true; drawGraph();
    };
    graphHost.onMouseMove = function(position) {
        if (closed) return;
        if (endpointDrag) { moveEndpoint(position, false); return; }
        if (guideDrag) { moveGuide(position, false); return; }
        var oldEndpoint = endpointHover, oldGuide = guideHover;
        updateGraphHover(position);
        if (oldEndpoint !== endpointHover || oldGuide !== guideHover) drawGraph();
    };
    graphHost.onMouseRelease = function(position, buttonName) {
        if (closed) return;
        if (endpointDrag) {
            var side = endpointDrag.side, released = buttonName === undefined || buttonName === "left";
            if (released) {
                if (position) moveEndpoint(position, true);
                else if (endpointDrag.moved) call("setEndpoint", [endpointDrag.side, endpointValue(endpointDrag.side), true, "drag"]);
            }
            var clicked = released && endpointDrag && !endpointDrag.moved;
            endpointDrag = null; updateGraphHover(position); drawGraph();
            if (clicked && endpointActive(side)) call("openWeightEditor", [side]);
            return;
        }
        if (!guideDrag) return;
        if (buttonName !== undefined && buttonName !== "left") { guideDrag = null; drawGraph(); return; }
        // Native input may deliver only press/release; use the final position.
        if (position) moveGuide(position, true);
        else if (guideDrag.moved) call("setBothMidpoint", [bothMidpoint(), true, "drag"]);
        var clicked = !guideDrag.moved;
        guideDrag = null; guideHover = guideHit(position); drawGraph();
        if (clicked && state().direction === "in out") call("openWeightEditor", ["midpoint"]);
    };
    graphHost.onMouseEnter = function(position) {
        if (closed) return;
        updateGraphHover(position); drawGraph();
    };
    graphHost.onMouseLeave = function() { if (!closed) { guideHover = false; endpointHover = null; drawGraph(); } };
    divider.onMousePress = function(position, buttonName) {
        if (closed || buttonName !== "left") return;
        drag = { y: position.y };
        drawDivider(true);
    };
    divider.onMouseMove = function(position) {
        if (!drag || closed) return;
        // Native mouse positions use y-up coordinates. The divider itself moves
        // with each resize, so compensate using the current graph height.
        var height = graphHeight + drag.y - position.y;
        if (isFinite(height)) resize(Math.round(height));
    };
    divider.onMouseRelease = function(position, buttonName) {
        if (!drag) return;
        // Some native input sources deliver only press/release for a drag.
        // Apply the final pointer position as well as intermediate moves.
        if (position && (buttonName === undefined || buttonName === "left") && isFinite(position.y) && position.y !== drag.y) {
            var finalHeight = graphHeight + drag.y - position.y;
            if (isFinite(finalHeight)) resize(Math.round(finalHeight));
        }
        drag = null;
        if (typeof controller.savePreferences === "function") controller.savePreferences({ graphHeight: graphHeight });
        drawDivider(false);
    };
    divider.onMouseDoubleClick = function(position, buttonName) {
        if (closed || buttonName !== "left") return;
        drag = null; resize(210);
        if (typeof controller.savePreferences === "function") controller.savePreferences({ graphHeight: graphHeight });
    };
    divider.onMouseEnter = function() { if (!closed) { dividerHover = true; drawDivider(); } };
    divider.onMouseLeave = function() { if (!closed) { dividerHover = false; drawDivider(); } };

    function openWeightEditor(kind) {
        if (closed || !weightActive(kind)) return;
        if (weightEditor) weightEditor.dismiss();
        var isMidpoint = kind === "midpoint", minimum = isMidpoint ? 0.01 : 0, maximum = isMidpoint ? 0.99 : 1;
        var title = isMidpoint ? "Midpoint" : kind === "bottom" ? "Bottom weight" : "Top weight";
        var caption = isMidpoint ? "Adjust mid point" : title;
        var current = isMidpoint ? bothMidpoint() : endpointValue(kind);
        // The graph handles remain the sliders. Cavalry's native input modal
        // supplies a reliable titled editor without a secondary Container.
        var alive = true, editorRef = {kind:kind, dismiss:function() {
            alive = false;
            if (weightEditor === editorRef) weightEditor = null;
        }};
        weightEditor = editorRef;
        var entered;
        try { entered = new ui.Modal().showStringInput(title, caption, String(current)); }
        finally { if (weightEditor === editorRef) weightEditor = null; }
        if (!alive || closed || !weightActive(kind)) return;
        var text = entered === null || entered === undefined ? "" : String(entered).trim();
        if (!text) return; // Cancel and an empty entry leave the value unchanged.
        var number = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
        if (!isFinite(number) || number < minimum || number > maximum) {
            new ui.Modal().showMessage("Enter a " + title.toLowerCase() + " from " + minimum + " to " + maximum + ".");
            return;
        }
        if (isMidpoint) call("setBothMidpoint", [number, true, "numeric"]);
        else call("setEndpoint", [kind, number, true, "numeric"]);
    }
    function openMidpointEditor() { openWeightEditor("midpoint"); }

    function drawThumbnail(canvas, preset, size, c, selected) {
        canvas.clearPaths();
        canvas.setBackgroundColor(selected ? c.selected : c.surface);
        var inset = size > 40 ? Math.round(size * 0.14) : 4;
        var box = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 };
        try {
            var data = cachedSamples(preset.expression || "x", 56, false);
            if (data.error) throw data.error;
            drawSamples(canvas, data.values, box, data.low, data.high, selected ? c.accent : c.text, size > 40 ? 1.7 : 1.4, data.geometry);
        } catch (e) { line(canvas, inset, inset, size - inset, size - inset, c.muted, 1.5); }
        canvas.redraw();
    }
    function presetItem(preset, index, tileSize, isGrid, c) {
        var id = preset.id === undefined ? index : preset.id;
        var size = isGrid ? tileSize : 29;
        var thumb = new ui.Draw();
        thumb.setSize(size, size); thumb.setTransparentForMouseEvents(true);
        var familyName = String(preset.name || "PRESET").toUpperCase();
        var nameSize = isGrid ? clamp(Math.floor(tileSize / Math.max(1, familyName.length * 0.58)), 8, 11) : 12;
        var name = label(familyName, nameSize);
        name.setTransparentForMouseEvents(true);
        var type = label(String(preset.type || "").toLowerCase(), isGrid ? 10 : 11);
        type.setTransparentForMouseEvents(true);
        var content = isGrid ? new ui.VLayout() : new ui.HLayout();
        content.setMargins(isGrid ? 0 : 5, isGrid ? 0 : 4, isGrid ? 0 : 5, isGrid ? 0 : 4);
        content.setSpaceBetween(isGrid ? 3 : 9);
        content.add(thumb); content.add(name); content.add(type);
        if (!isGrid) content.addStretch();
        var host = new ui.Container();
        host.setLayout(content); host.setRadius(3, 3, 3, 3); host.useHoverEvents(true);
        if (isGrid) {
            host.setFixedWidth(tileSize); host.setFixedHeight(tileSize + 34);
            name.setFixedWidth(tileSize); type.setFixedWidth(tileSize);
        } else host.setFixedHeight(37);
        host.setToolTip(String(preset.name || "PRESET") + (preset.type ? " " + preset.type : "") + "\n" + (preset.expression || "Clear magic expression"));
        var ref = { host: host, thumb: thumb, name: name, type: type, preset: preset, id: id, size: size, hover: false, isGrid: isGrid };
        function paint() {
            if (closed) return;
            var tokens = colors(), selected = state().selectedPreset === id;
            host.setBackgroundColor(selected ? tokens.selected : ref.hover ? blend(tokens.bg, tokens.accent, 0.08) : tokens.bg);
            name.setTextColor(selected ? tokens.text : tokens.muted); type.setTextColor(tokens.muted);
            drawThumbnail(thumb, preset, size, tokens, selected);
        }
        host.onMousePress = function(position, buttonName) {
            if (closed) return;
            if (buttonName === "left") call("selectPreset", [id]);
            else if (buttonName === "right") {
                ui.clearContextMenu();
                ui.addMenuItem({name:"Delete Preset", onMouseRelease:function() { call("deletePreset", [id]); }});
                ui.showContextMenu();
            }
        };
        host.onMouseEnter = function() { ref.hover = true; paint(); };
        host.onMouseLeave = function() { ref.hover = false; paint(); };
        ref.paint = paint;
        paint();
        presetRefs.push(ref);
        return host;
    }
    function rebuildPresets(force) {
        var s = state(), c = colors(), presets = controller.getPresets() || [];
        var isGrid = s.layout !== "list";
        var columns = Math.max(1, Math.min(6, Math.floor((width + 8) / 72)));
        var tileSize = clamp(Math.floor((width - 8 * (columns - 1)) / columns), 55, 86);
        var key = JSON.stringify({ layout: isGrid, size: tileSize, presets: presets });
        if (!force && key === lastPresetKey) {
            for (var p = 0; p < presetRefs.length; p++) presetRefs[p].paint();
            return;
        }
        lastPresetKey = key; presetRefs = [];
        presetLayout.clear();
        if (!presets.length) return;
        if (isGrid) {
            var grid = new ui.FlowLayout(8, 8);
            grid.setMargins(0, 0, 0, 0); grid.setSpaceBetween(8);
            for (var i = 0; i < presets.length; i++) grid.add(presetItem(presets[i], i, tileSize, true, c));
            var host = new ui.Container();
            host.setLayout(grid);
            var height = grid.getHeightForWidth(width);
            if (height > 0) host.setFixedHeight(height);
            presetLayout.add(host);
        } else {
            for (var j = 0; j < presets.length; j++) presetLayout.add(presetItem(presets[j], j, tileSize, false, c));
        }
    }
    function resize(requestedHeight) {
        if (closed || resizing) return;
        resizing = true;
        try {
            var targetHeight = requestedHeight === undefined ? graphHeight : requestedHeight;
            var nextHeight = Math.max(120, isFinite(targetHeight) ? Math.round(targetHeight) : 210);
            var heightChanged = nextHeight !== graphHeight;
            if (heightChanged) {
                graphHeight = nextHeight;
                graphHost.setFixedHeight(graphHeight);
                graph.setSize(width, graphHeight); graph.setMinimumWidth(160);
            }
            var widthChanged = syncCanvasWidths();
            if (!heightChanged && !widthChanged) return;
            refreshPresetHeader();
            if (widthChanged) rebuildPresets(true);
            drawGraph(); drawDivider(false); drawPowerSlider();
        } finally { resizing = false; }
    }
    function refresh() {
        if (closed) return;
        stateSnapshot = controller.getState() || {};
        // Recheck descriptor signatures once per refresh, including callers
        // that update an existing array; pointer-only paints use the snapshot.
        selectionCache.source = null;
        var s = state(), c = colors(), expression = s.expression || "";
        syncing = true;
        try {
            if (input.getText() !== expression) input.setText(expression);
            input.setPlaceholder(s.customMixed ? "Mixed expressions — type to replace selected easing" : s.nativeMagic ? "Native Magic Easing — type to replace" : "Magic expression, e.g. x^3");
            var power = Number(s.power) || 4;
            var powerText = powerSelected() ? String(power) : "";
            if (!powerSelected()) powerEditing = false;
            if (!powerEditing && powerField.getText() !== powerText) powerField.setText(powerText);
        } finally { syncing = false; }
        for (var b = 0; b < buttons.length; b++) buttons[b].setBackgroundColor(c.surface);
        input.setBackgroundColor(c.surface); input.setTextColor(c.text);
        powerField.setBackgroundColor(c.surface); powerLabel.setTextColor(c.text);
        inputField.host.setBackgroundColor(c.surface); numericField.host.setBackgroundColor(c.surface);
        powerField.setTextColor(c.text);
        inputGroup.setBackgroundColor(c.raised); tabGroup.setBackgroundColor(c.raised);
        directionGroup.setBackgroundColor(c.raised); actionGroup.setBackgroundColor(c.raised);
        graphHost.setBackgroundColor(c.bg);
        libraryButton.setBackgroundColor(c.bg);
        var direction = directions.indexOf(s.direction || "out") < 0 ? "out" : (s.direction || "out");
        if (endpointHover && !endpointActive(endpointHover)) endpointHover = null;
        if (endpointDrag && !endpointActive(endpointDrag.side)) endpointDrag = null;
        if (!powerSelected() || direction !== "in out") { guideHover = false; guideDrag = null; }
        if (weightEditor && !weightActive(weightEditor.kind)) weightEditor.dismiss();
        for (var d = 0; d < directionButtons.length; d++) {
            var selectedDirection = powerSelected() && directions[d] === direction;
            directionButtons[d].setText(directionCaptions[d]);
            directionButtons[d].setBackgroundColor(selectedDirection ? c.selected : c.raised);
            directionButtons[d].setToolTip("Preview " + directionCaptions[d] + " Power easing." + (s.applyOnDirection ? " Apply on direction is on." : " Click Apply to update keyframes, or enable Apply on direction in Settings."));
        }
        valueButton.setBackgroundColor(mode() === "value" ? c.selected : c.raised);
        speedButton.setBackgroundColor(mode() === "speed" ? c.selected : c.raised);
        applyButton.setEnabled(s.canApply !== false);
        var needsApply = s.canApplyPower !== false;
        applyPowerButton.setBackgroundColor(needsApply ? c.accent : "#434343");
        applyPowerLabel.setText(!needsApply && (s.selectedPowerLevels || []).length && (powerSelected() || !!s.powerExpression) ? "Applied" : "Apply");
        applyPowerLabel.setTextColor(needsApply ? c.text : c.muted);
        flattenButton.setEnabled(s.canFlatten !== false);
        clearButton.setEnabled(s.canClear !== false);
        presetTitle.setTextColor(c.muted); libraryNameLabel.setTextColor("#ffffff");
        selectedPowerLabel.setTextColor(c.muted);
        var message = s.status || (typeof s.error === "string" ? s.error : "");
        input.setToolTip("Use x from 0 to 1. Sync expression in Settings links this field to the Power controls." + (message ? "\n" + message : ""));
        var graphHelp = "Selected curves are grey; Power is purple. Drag the divider below to resize.";
        if (s.selectionPreviewLimited) graphHelp += "\nShowing the first 10 selected keyframes. Apply, Clear and Flatten use the full selection.";
        if (powerSelected()) {
            graphHelp += "\nDrag horizontal handles toward the centre to adjust endpoint slope; click to enter a weight, or right-click a handle to reset.";
            if (endpointActive("bottom")) graphHelp += " Bottom: " + endpointValue("bottom") + ".";
            if (endpointActive("top")) graphHelp += " Top: " + endpointValue("top") + ".";
        }
        if (powerSelected() && direction === "in out") graphHelp += "\nDrag the vertical line in 1% steps, click to adjust the midpoint, or right-click to reset to 0.5. Current: " + bothMidpoint();
        graphHelp += "\nRight-click an empty area for Reset Weights.";
        graph.setToolTip(graphHelp + (message ? "\n" + message : ""));
        graphHost.setToolTip(graphHelp + (message ? "\n" + message : ""));
        applyPowerButton.setToolTip("Apply the current expression." + (message ? "\n" + message : ""));
        powerSlider.setToolTip("Drag whole-number Power 1 to " + maxPower() + (powerSelected() ? ". Current: " + power : ". Custom expression: no Power setting selected.") + "\nType a precise Power above 12 in the numeric field." + (s.applyOnDrag ? "\nApply on drag is on." : "\nPreview only; click Apply to update keyframes.") + (message ? "\n" + message : ""));
        ui.setBackgroundColor(c.bg);
        var themeKey = c.bg + c.text;
        rebuildPresets(themeKey !== lastThemeKey); lastThemeKey = themeKey;
        syncCanvasWidths();
        refreshPresetHeader();
        drawGraph(); drawDivider(false); drawPowerSlider();
    }
    ui.onResize = function() { resize(); };
    var initial = state();
    graphHeight = Math.max(120, Number(initial.graphHeight) || 210);
    localMode = initial.mode || "value";
    graph.setSize(width, graphHeight);
    graph.setMinimumWidth(160); powerSliderCanvas.setMinimumWidth(0); dividerCanvas.setMinimumWidth(0);
    graphHost.setFixedHeight(graphHeight);
    refresh();
    // Docking can finish laying out children after the root's resize callback.
    // Observe allocation changes without redrawing an unchanged panel.
    var layoutTimer = new api.Timer({onTimeout:function() { resize(); }});
    layoutTimer.setInterval(120); layoutTimer.setRepeating(true); layoutTimer.start();
    return {
        refresh: refresh,
        layoutChanged: function() {
            if (closed) return;
            lastPresetKey = null;
            // Preferences and the active library can change independently of
            // the last snapshot. Refresh obtains one new snapshot and rebuilds
            // the presets and header before using its saved graph height.
            refresh();
            resize(Number(state().graphHeight) || 210);
        },
        resize: resize,
        openWeightEditor: openWeightEditor,
        openMidpointEditor: openMidpointEditor,
        onClose: function() { closed = true; if (weightEditor) weightEditor.dismiss(); drag = null; guideDrag = null; guideHover = false; endpointDrag = null; endpointHover = null; dividerHover = false; sliderDragging = false; presetRefs = []; graphScene = null; selectionCache = {source:null, key:null, curves:[], value:null, speed:null}; functionRefs = []; stateSnapshot = null; compiledCache.clear(); sampleCache.clear(); pathCache.clear(); layoutTimer.stop(); }
    };
}
