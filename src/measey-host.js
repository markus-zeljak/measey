/* Measey — original Cavalry keyframe adapter, 2026.
 * Target: Cavalry 2.7.2 and later; editor/UI api only.
 * Verified API signatures: installed assets/MetaData/api_function_metadata.json
 * and https://cavalry.studio/docs/tech-info/scripting/api-module/
 * Magic fallback data fields easing/exprEasing/numValue verified in Cavalry.
 * Keyframe data.colorId writing and readback verified in Cavalry 2.7.2.
 */
var MeaseyHost = (function () {
    "use strict";
    var active = 0;
    var NONE = "None";
    var PLUM = 11;
    var SILVER = 16;
    var lastSnapshot = null;
    function finite(v) { return typeof v === "number" && isFinite(v); }
    function clone(v) { return JSON.parse(JSON.stringify(v)); }
    function mathModule(math) { return math || (typeof MeaseyMath !== "undefined" ? MeaseyMath : null); }
    function guarded(fn) { active++; try { return fn(); } finally { active--; } }
    function dictionary(attr, object) { var result = {}; result[attr] = object; return result; }
    function parsePath(path) {
        var hash = path.indexOf("#");
        var split = path.indexOf(".", hash < 0 ? 0 : hash);
        return split < 0 ? null : {layerId: path.slice(0, split), attrId: path.slice(split + 1)};
    }
    function readData(id) { var data = api.get(id, "data"); return data && typeof data === "object" ? clone(data) : {}; }
    function restoreKey(key) {
        try { api.set(key.id, {data: clone(key.data)}); }
        catch (e) { /* The operation error is still reported to the panel. */ }
    }
    function magicOf(key) {
        if (typeof api.getMagicEasing === "function") {
            try {
                var nativeMagic = api.getMagicEasing(key.layerId, key.attrId, key.frame);
                if (nativeMagic) return {name: nativeMagic.easingName || NONE, easingName: nativeMagic.easingName || NONE, expression: nativeMagic.expression || "", active: !!nativeMagic.easingName && nativeMagic.easingName !== NONE};
            } catch (e) { /* 2.7 uses the keyData fallback below. */ }
        }
        var expression = typeof key.data.exprEasing === "string" ? key.data.exprEasing : "";
        var enabled = key.data.easing !== undefined && key.data.easing !== null && key.data.easing !== 0;
        return {name: enabled ? (expression ? "Custom" : "Magic Easing") : NONE,
            easingName: enabled ? (expression ? "Custom" : "Magic Easing") : NONE,
            expression: enabled ? expression : "", active: enabled, enumValue: key.data.easing};
    }
    function keyAt(id, layer, attr, frame) {
        var key = {id: id, layerId: layer, attrId: attr, frame: frame, data: readData(id)};
        key.value = key.data.numValue;
        key.magic = magicOf(key);
        return key;
    }
    function selectionReader() {
        // These caches live for one read only: edits always fetch fresh key data.
        var attributes = Object.create(null), keys = Object.create(null), layers = Object.create(null);
        function attribute(layer, attr) {
            var path = layer + "." + attr;
            if (!attributes[path]) {
                var times = api.getKeyframeTimes(layer, attr) || [];
                var ids = api.getKeyframeIdsForAttribute(layer, attr) || [];
                var frameIds = Object.create(null), nextFrames = Object.create(null);
                for (var i = 0; i < times.length; i++) if (ids[i]) frameIds[times[i]] = ids[i];
                var sorted = times.slice().sort(function (a, b) { return a - b; });
                for (var j = 0; j + 1 < sorted.length; j++) nextFrames[sorted[j]] = sorted[j + 1];
                attributes[path] = {frameIds: frameIds, nextFrames: nextFrames};
            }
            return attributes[path];
        }
        return {
            attribute: attribute,
            key: function (id, layer, attr, frame) {
                if (!keys[id]) keys[id] = keyAt(id, layer, attr, frame);
                return keys[id];
            },
            layerExists: function (id) {
                if (layers[id] === undefined) layers[id] = typeof api.layerExists !== "function" || api.layerExists(id);
                return layers[id];
            }
        };
    }
    function pairedPosition(segment, reader) {
        if (segment.attrId !== "position.x" && segment.attrId !== "position.y") return false;
        var sibling = segment.attrId === "position.x" ? "position.y" : "position.x";
        try {
            if (reader) {
                var attribute = reader.attribute(segment.layerId, sibling);
                return !!attribute.frameIds[segment.startFrame] && !!attribute.frameIds[segment.endFrame];
            }
            var times = api.getKeyframeTimes(segment.layerId, sibling) || [];
            return times.indexOf(segment.startFrame) >= 0 && times.indexOf(segment.endFrame) >= 0;
        } catch (e) { return false; }
    }
    function pathGeometry(segment) {
        var axes = ["position.x", "position.y"], geometry = [];
        for (var a = 0; a < axes.length; a++) {
            var frames = api.getKeyframeTimes(segment.layerId, axes[a]) || [];
            var ids = api.getKeyframeIdsForAttribute(segment.layerId, axes[a]) || [];
            var endpoints = [segment.startFrame, segment.endFrame];
            for (var b = 0; b < endpoints.length; b++) {
                var index = frames.indexOf(endpoints[b]);
                if (index >= 0 && ids[index]) geometry.push({id: ids[index], attrId: axes[a], frame: endpoints[b], data: readData(ids[index])});
            }
        }
        return geometry;
    }
    function samplePositions(segment, count) {
        var saved = api.getFrame(), points = [];
        try {
            var steps = Math.max(1, Math.min(count - 1, segment.duration)), prior = null;
            for (var i = 0; i <= steps; i++) {
                var frame = Math.round(segment.startFrame + segment.duration * i / steps);
                if (frame === prior) continue; prior = frame;
                api.setFrame(frame);
                var x = api.get(segment.layerId, "position.x"), y = api.get(segment.layerId, "position.y");
                if (!finite(x) || !finite(y)) throw new Error("The motion path cannot be sampled.");
                points.push({frame: frame, x: x, y: y, time: (frame - segment.startFrame) / segment.duration});
            }
        } finally { api.setFrame(saved); }
        return points;
    }
    function neighboringKey(segment, frame, direction) {
        var frames = api.getKeyframeTimes(segment.layerId, segment.attrId) || [];
        var ids = api.getKeyframeIdsForAttribute(segment.layerId, segment.attrId) || [];
        var found = -1;
        for (var i = 0; i < frames.length; i++) {
            if (direction < 0 && frames[i] < frame && (found < 0 || frames[i] > frames[found])) found = i;
            if (direction > 0 && frames[i] > frame && (found < 0 || frames[i] < frames[found])) found = i;
        }
        return found < 0 ? null : {frame: frames[found], data: readData(ids[found])};
    }
    function writeBezier(segment, fit, position) {
        var originalStart = readData(segment.a.id), originalEnd = readData(segment.b.id);
        var previous = neighboringKey(segment, segment.startFrame, -1), following = neighboringKey(segment, segment.endFrame, 1);
        if (originalEnd.interpolation === 2 && following) throw new Error("The following span is Step; keep Magic to preserve that hold.");
        api.modifyKeyframe(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame, type: 0}));
        api.modifyKeyframe(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame, type: 0}));
        var unlockedStart = readData(segment.a.id), unlockedEnd = readData(segment.b.id);
        unlockedStart.locked = false; unlockedStart.weightLocked = false;
        unlockedEnd.locked = false; unlockedEnd.weightLocked = false;
        // Restore the untouched sides if changing interpolation initialized them.
        if (originalStart.leftBez) unlockedStart.leftBez = clone(originalStart.leftBez);
        if (originalEnd.rightBez) unlockedEnd.rightBez = clone(originalEnd.rightBez);
        api.set(segment.a.id, {data: unlockedStart}); api.set(segment.b.id, {data: unlockedEnd});
        if (!position && typeof api.clearKeyframeVelocity === "function") {
            api.clearKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame}));
            api.clearKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame}));
        }
        var delta = segment.endValue - segment.startValue;
        var y1 = finite(fit.handleValue1) ? fit.handleValue1 : segment.startValue + fit.y1 * delta;
        var y2 = finite(fit.handleValue2) ? fit.handleValue2 : segment.startValue + fit.y2 * delta;
        api.modifyKeyframeTangent(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame, outHandle: true, inHandle: false, angleLocked: false, weightLocked: false,
            xValue: segment.startFrame + fit.x1 * segment.duration, yValue: y1}));
        api.modifyKeyframeTangent(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame, inHandle: true, outHandle: false, angleLocked: false, weightLocked: false,
            xValue: segment.startFrame + fit.x2 * segment.duration, yValue: y2}));
        if (position) {
            // Cavalry 2.7 honors position Bezier handles when facing speeds are 1.
            // Seed all velocity fields while preserving the neighboring sides.
            api.setKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.startFrame,
                rightSpeed: 1, rightInfluence: 0.333,
                leftSpeed: finite(originalStart.leftSpeed) ? originalStart.leftSpeed : 1,
                leftInfluence: finite(originalStart.leftInfluence) ? originalStart.leftInfluence : 0.333}));
            api.setKeyframeVelocity(segment.layerId, dictionary(segment.attrId, {frame: segment.endFrame,
                leftSpeed: 1, leftInfluence: 0.333,
                rightSpeed: finite(originalEnd.rightSpeed) ? originalEnd.rightSpeed : 1,
                rightInfluence: finite(originalEnd.rightInfluence) ? originalEnd.rightInfluence : 0.333}));
        }
        // A native key's interpolation flag controls both tangent sides. Keep the
        // fitted endpoints Bezier; reproduce a neighboring Linear tangent explicitly.
        // Preserve neighboring Magic flags and existing outer handle/velocity data.
        var currentStart = readData(segment.a.id), currentEnd = readData(segment.b.id);
        var startFields = ["leftBez", "leftSpeed", "leftInfluence"];
        var endFields = ["rightBez", "rightSpeed", "rightInfluence", "easing", "exprEasing"];
        for (var sf = 0; sf < startFields.length; sf++) {
            var sk = startFields[sf];
            if (originalStart[sk] === undefined) delete currentStart[sk]; else currentStart[sk] = clone(originalStart[sk]);
        }
        for (var ef = 0; ef < endFields.length; ef++) {
            var ek = endFields[ef];
            if (originalEnd[ek] === undefined) delete currentEnd[ek]; else currentEnd[ek] = clone(originalEnd[ek]);
        }
        if ((originalStart.interpolation === undefined || originalStart.interpolation === 1) && previous && finite(previous.data.numValue)) {
            currentStart.leftBez = {x: 0, y: 0};
        }
        if ((originalEnd.interpolation === undefined || originalEnd.interpolation === 1) && following && finite(following.data.numValue)) {
            currentEnd.rightBez = {x: 0, y: 0};
        }
        currentStart.interpolation = 0; currentEnd.interpolation = 0;
        api.set(segment.a.id, {data: currentStart}); api.set(segment.b.id, {data: currentEnd});
    }
    function axisSegment(geometry, segment, attr) {
        var a = null, b = null;
        for (var i = 0; i < geometry.length; i++) if (geometry[i].attrId === attr) {
            if (geometry[i].frame === segment.startFrame) a = keyAt(geometry[i].id, segment.layerId, attr, segment.startFrame);
            else b = keyAt(geometry[i].id, segment.layerId, attr, segment.endFrame);
        }
        if (!a || !b) throw new Error("The linked position channel cannot be read.");
        return {a: a, b: b, layerId: segment.layerId, attrId: attr, startFrame: segment.startFrame, endFrame: segment.endFrame,
            duration: segment.duration, startValue: a.value, endValue: b.value, magic: a.magic, isMotionPath: true};
    }
    function fitAxis(segment, points, math, preferred) {
        if (segment.magic.expression) return math.fitBezier(math.compile(segment.magic.expression), {optimizeX: true});
        var delta = segment.endValue - segment.startValue, axis = segment.attrId === "position.x" ? "x" : "y";
        if (Math.abs(delta) > 1e-12) {
            var samples = points.map(function (p) { return {x: p.time, y: (p[axis] - segment.startValue) / delta}; });
            return math.fitBezier(interpolate(samples), {optimizeX: true});
        }
        // Equal endpoint values can still describe an ordinary curved channel.
        // Retain its time handles and solve the two value handles against samples.
        var a = segment.a.data, b = segment.b.data;
        var x1 = a.rightBez ? Math.max(0, Math.min(1, a.rightBez.x / segment.duration)) : preferred.x1;
        var x2 = b.leftBez ? Math.max(0, Math.min(1, 1 + b.leftBez.x / segment.duration)) : preferred.x2;
        var aa = 0, ab = 0, bb = 0, av = 0, bv = 0;
        function parameter(x) {
            var lo = 0, hi = 1;
            for (var i = 0; i < 45; i++) { var t = (lo + hi) / 2, u = 1 - t, value = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t; if (value < x) lo = t; else hi = t; }
            return (lo + hi) / 2;
        }
        for (var i = 0; i < points.length; i++) {
            var t = parameter(points[i].time), u = 1 - t, w1 = 3 * u * u * t, w2 = 3 * u * t * t;
            var residual = points[i][axis] - (u * u * u * segment.startValue + t * t * t * segment.endValue);
            aa += w1 * w1; ab += w1 * w2; bb += w2 * w2; av += w1 * residual; bv += w2 * residual;
        }
        var determinant = aa * bb - ab * ab;
        var v1 = determinant > 1e-12 ? (av * bb - bv * ab) / determinant : segment.startValue;
        var v2 = determinant > 1e-12 ? (bv * aa - av * ab) / determinant : segment.endValue;
        return {x1: x1, x2: x2, y1: 0, y2: 1, handleValue1: v1, handleValue2: v2, endpointMismatch: 0, maxError: 0, rmsError: 0};
    }
    function flattenPosition(segment, fit, math, geometry, target) {
        var axes = ["position.x", "position.y"], fits = [];
        for (var i = 0; i < axes.length; i++) {
            var axis = axisSegment(geometry, segment, axes[i]);
            var curve = fitAxis(axis, target, math, fit);
            if (curve.endpointMismatch > 0.0001) throw new Error("Curve endpoints must be 0 and 1 to flatten.");
            if (axis.magic.active) api.magicEasing(axis.layerId, axis.attrId, axis.startFrame, NONE);
            writeBezier(axis, curve, true); fits.push({segment: axis, curve: curve});
        }
        var actual = samplePositions(segment, target.length), scale = 1, maxError = 0;
        var first = target[0];
        for (var j = 0; j < target.length; j++) scale = Math.max(scale, Math.sqrt(Math.pow(target[j].x - first.x, 2) + Math.pow(target[j].y - first.y, 2)));
        for (var k = 0; k < actual.length; k++) maxError = Math.max(maxError, Math.sqrt(Math.pow(actual[k].x - target[k].x, 2) + Math.pow(actual[k].y - target[k].y, 2)) / scale);
        if (maxError > 0.06) throw new Error("This position animation cannot be matched closely by one Bezier curve (" + (maxError * 100).toFixed(1) + "% error).");
        fit.maxError = Math.max(fit.maxError, maxError);
        return {fits: fits, maxError: maxError};
    }
    function sampleHost(segment, count) {
        if (!finite(segment.startValue) || !finite(segment.endValue)) return null;
        var savedFrame = api.getFrame();
        var points = [];
        var delta = segment.endValue - segment.startValue;
        if (Math.abs(delta) < 1e-12) return null;
        try {
            var steps = Math.max(1, Math.min(count - 1, segment.duration));
            var previousFrame = null;
            for (var i = 0; i <= steps; i++) {
                var frame = Math.round(segment.startFrame + segment.duration * i / steps);
                if (frame === previousFrame) continue;
                previousFrame = frame;
                api.setFrame(frame);
                var value = api.get(segment.layerId, segment.attrId);
                if (!finite(value)) return null;
                points.push({x: (frame - segment.startFrame) / segment.duration, y: (value - segment.startValue) / delta});
            }
        } finally { api.setFrame(savedFrame); }
        return points;
    }
    function interpolate(points) {
        return function (x) {
            if (x <= points[0].x) return points[0].y;
            for (var i = 1; i < points.length; i++) if (x <= points[i].x) {
                var a = points[i - 1], b = points[i], t = (x - a.x) / (b.x - a.x);
                return a.y + (b.y - a.y) * t;
            }
            return points[points.length - 1].y;
        };
    }
    function previewReader(math) {
        var samples = Object.create(null), expressions = Object.create(null);
        return {
            sample: function (signature, fn) {
                if (!samples[signature]) {
                    try { samples[signature] = {samples: math.sample(fn, 129)}; }
                    catch (e) { samples[signature] = {error: e.message}; }
                }
                return samples[signature];
            },
            expressionError: function (expression) {
                if (!expressions[expression]) {
                    try { math.compile(expression); expressions[expression] = {ok: true}; }
                    catch (e) { expressions[expression] = {error: e.message}; }
                }
                return expressions[expression].error;
            }
        };
    }
    function segmentCurve(segment, math, includeSamples, previews) {
        var expression = segment.magic.expression;
        var result = {keyId: segment.a.id, expression: expression, magic: segment.magic.active,
            layerId: segment.layerId, attrId: segment.attrId, startFrame: segment.startFrame, endFrame: segment.endFrame, samples: null};
        if (expression) {
            if (!math) return result;
            if (includeSamples) {
                var sampled = previews.sample("expression:" + expression, expression);
                result.samples = sampled.samples || null; result.error = sampled.error;
            } else {
                // Descriptor previews avoid sampling here, but unsupported ExprTk
                // expressions retain the native fallback used by the full preview.
                result.error = previews.expressionError(expression);
            }
            if (!result.error) return result;
        }
        var a = segment.a.data, b = segment.b.data;
        if (!segment.magic.active && !segment.isMotionPath && finite(segment.startValue) && finite(segment.endValue)) {
            var delta = segment.endValue - segment.startValue;
            if (a.interpolation === 2) {
                result.samples = [{x: 0, y: 0}, {x: 0.999999, y: 0}, {x: 1, y: 1}];
            } else if (a.interpolation === 1 || Math.abs(delta) < 1e-12 || (!a.rightBez && !b.leftBez)) {
                result.samples = [{x: 0, y: 0}, {x: 1, y: 1}];
            } else {
                var outgoing = a.rightBez || {x: segment.duration / 3, y: delta / 3};
                var incoming = b.leftBez || {x: -segment.duration / 3, y: -delta / 3};
                result.bezier = {x1: outgoing.x / segment.duration, y1: outgoing.y / delta,
                    x2: 1 + incoming.x / segment.duration, y2: 1 + incoming.y / delta};
                if (includeSamples && math) {
                    var controls = result.bezier;
                    var sampledBezier = previews.sample("bezier:" + [controls.x1, controls.y1, controls.x2, controls.y2].join(","),
                        function (x) { return math.bezierValue(x, controls); });
                    result.samples = sampledBezier.samples || null; result.error = sampledBezier.error;
                }
            }
            return result;
        }
        result.samples = sampleHost(segment, 129);
        if (!result.samples && expression) result.error = result.error || "This expression cannot be previewed.";
        return result;
    }
    function readSelection(math, options) {
        math = mathModule(math); options = options || {};
        return guarded(function () {
            var selection = api.getSelectedKeyframes() || {};
            var selectedIds = api.getSelectedKeyframeIds() || [];
            var idLookup = Object.create(null), keys = [], segments = [], errors = [], groups = [];
            var reader = selectionReader(), previews = previewReader(math);
            for (var id = 0; id < selectedIds.length; id++) idLookup[selectedIds[id]] = true;
            var paths = Object.keys(selection);
            for (var p = 0; p < paths.length; p++) {
                var parsed = parsePath(paths[p]);
                if (!parsed) { errors.push("An invalid attribute path was skipped."); continue; }
                try {
                    if (!reader.layerExists(parsed.layerId)) continue;
                    var attribute = reader.attribute(parsed.layerId, parsed.attrId);
                    var frameIds = attribute.frameIds;
                    var frames = selection[paths[p]].slice().sort(function (a, b) { return a - b; });
                    var group = {layerId: parsed.layerId, attrId: parsed.attrId, frames: frames, keys: []};
                    for (var f = 0; f < frames.length; f++) {
                        var frame = frames[f], keyId = frameIds[frame];
                        if (!keyId || (selectedIds.length && !idLookup[keyId])) continue;
                        var key = reader.key(keyId, parsed.layerId, parsed.attrId, frame);
                        keys.push(key); group.keys.push(key);
                        var nextFrame = attribute.nextFrames[frame], nextId = frameIds[nextFrame];
                        if (!nextId) continue;
                        var next = reader.key(nextId, parsed.layerId, parsed.attrId, nextFrame);
                        var segment = {a: key, b: next, layerId: parsed.layerId, attrId: parsed.attrId,
                            startFrame: frame, endFrame: nextFrame, startValue: key.value, endValue: next.value,
                            duration: nextFrame - frame, magic: key.magic};
                        segment.isMotionPath = pairedPosition(segment, reader);
                        segments.push(segment);
                    }
                    groups.push(group);
                } catch (e) { errors.push(parsed.attrId + ": " + e.message); }
            }
            var expressions = [], magicNames = [], expressionLookup = Object.create(null), magicLookup = Object.create(null);
            // The terminal key has no outgoing interval. Its stored flag should
            // not make an otherwise uniform selected interval look mixed.
            var representativeKeys = segments.length ? segments.map(function (s) { return s.a; }) : keys;
            for (var ki = 0; ki < representativeKeys.length; ki++) {
                var representative = representativeKeys[ki];
                var expr = representative.magic.expression || (representative.magic.active ? "" : "x");
                if (!expressionLookup[expr]) { expressionLookup[expr] = true; expressions.push(expr); }
                if (!magicLookup[representative.magic.name]) { magicLookup[representative.magic.name] = true; magicNames.push(representative.magic.name); }
            }
            var curves = [];
            var limitedPreview = finite(options.previewLimit);
            var previewKeyCount = limitedPreview ? Math.min(keys.length, Math.max(0, Math.floor(options.previewLimit))) : keys.length;
            if (options.preview !== false) {
                var previewSegments = Object.create(null);
                for (var si = 0; si < segments.length; si++) previewSegments[segments[si].a.id] = segments[si];
                // Budget selected keys before constructing or sampling a curve.
                // A terminal key consumes its slot; later keys never fill it.
                for (var pi = 0; pi < previewKeyCount; pi++) {
                    var previewKey = keys[pi], previewSegment = previewSegments[previewKey.id];
                    if (previewSegment) curves.push(segmentCurve(previewSegment, math, options.samples !== false, previews));
                    else if ((limitedPreview || !segments.length) && previewKey.magic.expression) {
                        var terminalCurve = {keyId: previewKey.id, expression: previewKey.magic.expression, magic: true,
                            layerId: previewKey.layerId, attrId: previewKey.attrId, startFrame: previewKey.frame, samples: null};
                        if (math && options.samples !== false) {
                            var terminalSample = previews.sample("expression:" + terminalCurve.expression, terminalCurve.expression);
                            terminalCurve.samples = terminalSample.samples || null; terminalCurve.error = terminalSample.error;
                        }
                        curves.push(terminalCurve);
                    }
                }
            }
            var snapshot = {keys: keys, segments: segments, groups: groups, count: keys.length,
                selectedIds: keys.map(function (k) { return k.id; }), expression: expressions.length === 1 ? expressions[0] : "",
                curveExpression: segments.length ? segments[0].magic.expression : (expressions[0] || "x"),
                mixed: expressions.length > 1 || magicNames.length > 1, previewCurves: curves, curves: curves,
                errors: errors, activeComp: api.getActiveComp(),
                message: keys.length ? keys.length + " keyframe" + (keys.length === 1 ? "" : "s") + " selected" + (segments.length ? " · " + segments.length + " outgoing curve" + (segments.length === 1 ? "" : "s") : " · final keyframe") : "Select keyframes to preview their curves."};
            lastSnapshot = snapshot;
            return snapshot;
        });
    }
    function result(changed, skipped, errors, extra) {
        var output = {changed: changed, skipped: skipped, errors: errors || [], ok: changed > 0};
        var names = Object.keys(extra || {}); for (var i = 0; i < names.length; i++) output[names[i]] = extra[names[i]];
        output.message = output.message || (changed ? changed + " keyframe" + (changed === 1 ? "" : "s") + " updated" : (skipped ? "No keyframes updated" : "Select keyframes to update."));
        if (skipped) output.message += " · " + skipped + " skipped";
        if (output.errors.length) output.message += " · " + output.errors[0];
        return output;
    }
    function flushUpdates(changed, errors) {
        // One batch flush keeps GUI updates current without pumping events per key.
        if (changed && typeof api.processEvents === "function") {
            try { api.processEvents(); }
            catch (e) { errors.push("GUI update: " + e.message); }
        }
    }
    var host = {
        readSelection: readSelection,
        isBusy: function () { return active > 0; },
        lastSelection: function () { return lastSnapshot; },
        setColor: function (key, colorId) {
            // Read fresh data so colour never overwrites an easing/tangent edit.
            var data = readData(key.id); data.colorId = colorId;
            api.set(key.id, {data: data});
            if (readData(key.id).colorId !== colorId) {
                var name = colorId === PLUM ? "Plum" : (colorId === SILVER ? "Silver" : String(colorId));
                throw new Error("Cavalry did not retain the " + name + " keyframe color.");
            }
        },
        apply: function (expression, math) {
            math = mathModule(math);
            var validation = math.validate(expression);
            if (!validation.ok) return result(0, 0, [validation.error], {message: validation.error});
            return guarded(function () {
                var snapshot = readSelection(math, {samples: false, preview: false}), changed = 0, errors = [];
                for (var i = 0; i < snapshot.keys.length; i++) {
                    var key = snapshot.keys[i];
                    try {
                        // Step interpolation bypasses Magic Easing in Cavalry 2.7.2.
                        // A direct data change preserves existing handle coordinates.
                        if (key.data.interpolation === 2) {
                            var smooth = readData(key.id); smooth.interpolation = 0;
                            api.set(key.id, {data: smooth});
                        }
                        api.magicEasing(key.layerId, key.attrId, key.frame, "Custom", validation.expression); host.setColor(key, PLUM); changed++;
                    }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                flushUpdates(changed, errors);
                return result(changed, snapshot.keys.length - changed, errors, {expression: validation.expression});
            });
        },
        clear: function () {
            return guarded(function () {
                var snapshot = readSelection(null, {samples: false, preview: false}), changed = 0, errors = [];
                for (var i = 0; i < snapshot.keys.length; i++) {
                    var key = snapshot.keys[i];
                    try { api.magicEasing(key.layerId, key.attrId, key.frame, NONE); host.setColor(key, SILVER); changed++; }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                flushUpdates(changed, errors);
                return result(changed, snapshot.keys.length - changed, errors, {expression: "x"});
            });
        },
        flatten: function (math) {
            math = mathModule(math);
            return guarded(function () {
                var snapshot = readSelection(math, {samples: false, preview: false}), changed = 0, errors = [], fits = [], changedIds = {};
                var selectedLookup = Object.create(null), segmentLookup = Object.create(null);
                for (var selectedIndex = 0; selectedIndex < snapshot.selectedIds.length; selectedIndex++) selectedLookup[snapshot.selectedIds[selectedIndex]] = true;
                for (var segmentIndex = 0; segmentIndex < snapshot.segments.length; segmentIndex++) segmentLookup[snapshot.segments[segmentIndex].a.id] = true;
                for (var i = 0; i < snapshot.segments.length; i++) {
                    var segment = snapshot.segments[i];
                    var rollback = null;
                    if (!segment.magic.active || changedIds[segment.a.id]) continue;
                    try {
                        if (!finite(segment.startValue) || !finite(segment.endValue)) throw new Error("Flatten requires a numeric channel.");
                        var fn;
                        if (segment.magic.expression) fn = math.compile(segment.magic.expression);
                        else {
                            var samples = sampleHost(segment, 129);
                            if (!samples || samples.length < 2) throw new Error("This Magic curve cannot be sampled.");
                            fn = interpolate(samples);
                        }
                        var fit = math.fitBezier(fn, {optimizeX: true});
                        if (fit.endpointMismatch > 0.0001) throw new Error("Curve endpoints must be 0 and 1 to flatten.");
                        rollback = segment.isMotionPath ? pathGeometry(segment) : [{id: segment.a.id, data: readData(segment.a.id)}, {id: segment.b.id, data: readData(segment.b.id)}];
                        if (segment.isMotionPath) {
                            var target = samplePositions(segment, 65);
                            var pathResult = flattenPosition(segment, fit, math, rollback, target);
                            for (var ps = 0; ps < pathResult.fits.length; ps++) {
                                var pathKey = pathResult.fits[ps].segment.a;
                                // A linked axis may be selected too; don't flatten its span twice.
                                if (selectedLookup[pathKey.id] && !changedIds[pathKey.id]) {
                                    host.setColor(pathKey, SILVER); changedIds[pathKey.id] = true; changed++;
                                }
                            }
                            fits.push({keyId: segment.a.id, curve: fit, motionPath: true, nativeError: pathResult.maxError});
                            continue;
                        }
                        api.magicEasing(segment.layerId, segment.attrId, segment.startFrame, NONE);
                        writeBezier(segment, fit, false);
                        host.setColor(segment.a, SILVER); changedIds[segment.a.id] = true; changed++;
                        fits.push({keyId: segment.a.id, curve: fit, motionPath: segment.isMotionPath});
                    } catch (e) {
                        if (rollback) for (var r = 0; r < rollback.length; r++) restoreKey(rollback[r]);
                        errors.push(segment.attrId + ": " + e.message);
                    }
                }
                // After a successful conversion, tag selected ordinary keys Silver too.
                // A failed active span stays intact; a terminal Magic flag can be cleared.
                for (var j = 0; j < snapshot.keys.length; j++) {
                    var key = snapshot.keys[j];
                    if (changedIds[key.id]) continue;
                    var hasSegment = !!segmentLookup[key.id];
                    // Leave a failed Magic span intact; color ordinary selected keys after success.
                    if ((hasSegment && key.magic.active) || (!key.magic.active && !changed)) continue;
                    try { if (key.magic.active) api.magicEasing(key.layerId, key.attrId, key.frame, NONE); host.setColor(key, SILVER); changedIds[key.id] = true; changed++; }
                    catch (e) { restoreKey(key); errors.push(key.attrId + ": " + e.message); }
                }
                flushUpdates(changed, errors);
                var output = result(changed, snapshot.keys.length - changed, errors, {fits: fits});
                var maxError = 0;
                for (var k = 0; k < fits.length; k++) maxError = Math.max(maxError, fits[k].curve.maxError || 0, fits[k].nativeError || 0);
                output.maxError = maxError;
                if (fits.length) output.message += " · Bezier approximation " + (maxError * 100).toFixed(2) + "% max curve error";
                if (!changed && !errors.length) output.message = "Select keyframes with Magic Easing to flatten.";
                return output;
            });
        },
        sampleHost: sampleHost,
        math: mathModule(),
        colors: {magic: PLUM, clear: SILVER}
    };
    return host;
}());
if (typeof module !== "undefined" && module.exports) module.exports = MeaseyHost;
