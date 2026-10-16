"use strict";
const assert = require("assert");
const math = require("../src/curve-math.js");
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const tests = [];
function test(name, fn) { tests.push({name, fn}); }

test("official custom Magic Easing expressions and var := declarations", () => {
    near(math.compile("1 - pow(1 - x, 5)")(0.25), 1 - Math.pow(0.75, 5));
    near(math.compile("-(cos(PI * x) - 1) / 2")(0.5), 0.5);
    const source = "var c1 := 1.70158; var c2 := c1 * 1.525; x < 0.5 ? (pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2 : (pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;";
    const easing = math.compile(source);
    near(easing(0), 0); near(easing(0.5), 0.5); near(easing(1), 1);
    assert.ok(easing(0.15) < 0, "anticipation stays visible below zero");
    assert.ok(easing(0.85) > 1, "overshoot stays visible above one");
});
test("power precedence, negative powers, ternary associativity, t alias", () => {
    near(math.compile("-x^2")(0.5), -0.25);
    near(math.compile("2^3^2")(0), 512);
    near(math.compile("2^-2")(0), 0.25);
    near(math.compile("x < 0.25 ? 2 : x < 0.75 ? 3 : 4")(0.5), 3);
    const fn = math.compile("POW(t, 3) + sin(pi * t) * 0");
    near(fn(0.5), 0.125);
    assert.ok(!/\bt\b/.test(fn.expression));
    assert.ok(fn.expression.includes("PI"));
    assert.ok(fn.expression.includes("pow"));
});
test("ExprTk clamp order, lazy conditionals, booleans and equality", () => {
    near(math.compile("clamp(-2, x * 10, 3)")(0.5), 3);
    near(math.compile("if(x = 0, 0, log(x))")(0), 0);
    near(math.compile("x = 0 ? 0 : 1 / x")(0), 0);
    near(math.compile("x >= 0.2 and x < 0.8")(0.5), 1);
    near(math.compile("x < 0 or x > 1")(0.5), 0);
    near(math.compile("round(-1.5)")(0), -2);
    near(math.compile("root(-8, 3)")(0), -2);
});
test("no bundled presets and normalized Power 1 to 12 curves", () => {
    assert.deepEqual(math.defaults(), []);
    for (let power=1;power<=12;power++) {
        for (const type of ["in","out","in out"]) {
            const source=math.powerExpression(power,type), fn=math.compile(source);
            near(fn(0),0);near(fn(1),1);
            const points=math.sample(fn,101);
            for(let i=1;i<points.length;i++)assert.ok(points[i].y>=points[i-1].y-1e-12);
            if(type==="in out")near(fn(.5),.5);
            if(power===1)assert.equal(source,"x");
        }
    }
    near(math.compile(math.powerExpression(12,"in"))(.5),1/4096);
});
test("custom fractional powers preserve endpoints and symmetric in out easing", () => {
    for (const power of [1, 1.1, 1.5, 2.7, 10.5, 12]) {
        const inside = math.compile(math.powerExpression(power, "in"));
        const outside = math.compile(math.powerExpression(power, "out"));
        const both = math.compile(math.powerExpression(power, "in out"));
        near(inside(0), 0); near(inside(1), 1); near(outside(0), 0); near(outside(1), 1);
        near(both(0), 0); near(both(1), 1); near(both(0.5), 0.5);
        near(inside(0.25), Math.pow(0.25, power));
        near(outside(0.25), 1 - Math.pow(0.75, power));
        for (let i = 0; i <= 20; i++) near(both(i / 20) + both(1 - i / 20), 1);
        assert.ok(math.validate(math.powerExpression(power, "in out")).ok);
    }
    for (const power of [0, 0.5, -1, Infinity, NaN, "3", undefined]) assert.throws(() => math.powerExpression(power, "in"), /Power must/);
    assert.throws(() => math.powerExpression(3, "in sideways"), /Choose power easing type/);
});
test("Both midpoint preserves the old formula and strictly validates its own range", () => {
    const previous = "x < 0.5 ? pow(2 * x, 1.539) / 2 : 1 - pow(2 * (1 - x), 1.539) / 2";
    assert.equal(math.powerExpression(1.539, "in out"), previous);
    assert.equal(math.powerExpression(1.539, "in out", 0.5), previous);
    for (const midpoint of [0.01, 0.2, 0.5, 0.8, 0.99]) assert.equal(math.powerExpression(1, "in out", midpoint), "x");
    for (const midpoint of [0, 0.009, 0.991, 1, -1, NaN, Infinity, null, "0.2"]) {
        assert.throws(() => math.powerExpression(3, "in out", midpoint), /Both midpoint/, String(midpoint));
        assert.throws(() => math.powerExpression(1, "in out", midpoint), /Both midpoint/, String(midpoint));
        assert.equal(math.powerExpression(3, "in", midpoint), "pow(x, 3)");
        assert.equal(math.powerExpression(3, "out", midpoint), "1 - pow(1 - x, 3)");
    }
});
test("shifted Both curves stay normalized, monotonic and continuously differentiable", () => {
    for (const midpoint of [0.01, 0.2, 0.5, 0.8, 0.99]) for (const power of [1, 1.539, 2, 7, 12]) {
        const fn = math.compile(math.powerExpression(power, "in out", midpoint));
        near(fn(0), 0); near(fn(1), 1); near(fn(midpoint), midpoint, 1e-12);
        near(fn(midpoint * 0.37), midpoint * Math.pow(0.37, power), 1e-12);
        near(fn(midpoint + (1-midpoint) * 0.63), 1-(1-midpoint) * Math.pow(0.37, power), 1e-12);
        const points = math.sample(fn, 257);
        for (let i=1; i<points.length; i++) assert.ok(points[i].y >= points[i-1].y-1e-12);
        const h = Math.min(midpoint, 1-midpoint) * 1e-6;
        const leftVelocity = (fn(midpoint)-fn(midpoint-h))/h;
        const rightVelocity = (fn(midpoint+h)-fn(midpoint))/h;
        near(leftVelocity, power, 1e-4); near(rightVelocity, power, 1e-4);
        near(leftVelocity, rightVelocity, 1e-4);
        assert.ok((fn(midpoint-h)-fn(midpoint-2*h))/h <= leftVelocity+1e-7);
        assert.ok((fn(midpoint+2*h)-fn(midpoint+h))/h <= rightVelocity+1e-7);
    }
});
test("Power detection recognizes every family and stable fractional precision", () => {
    const powers = [...Array.from({length:12}, (_,i)=>i+1), 1.001, 1.539, 2.71828182846, 7.12345678901, 11.999];
    for (const power of powers) for (const direction of ["in","out","in out"]) {
        const detected = math.detectPower(math.powerExpression(power,direction));
        const expected = {power,direction:power===1?"in":direction};
        if (direction === "in out" && power !== 1) expected.midpoint = 0.5;
        assert.deepEqual(detected, expected, `${power} ${direction}`);
    }
    assert.deepEqual(math.detectPower("x"), {power:1,direction:"in"});
    assert.deepEqual(math.detectPower("1 - (1 - x)"), {power:1,direction:"in"});
});
test("Power detection handles aliases, declarations and equivalent mathematics", () => {
    for (const source of ["x^1.539", "t ** 1.539", "POW(t, 1.539)", "var p := 1.539; pow(x,p)", "if(x=0,0,exp(1.539*ln(x)))"]) {
        assert.deepEqual(math.detectPower(source), {power:1.539,direction:"in"}, source);
    }
    for (const source of ["1-(1-t)^3", "-(pow(1-x,3)-1)", "3*x-3*x*x+x*x*x"]) {
        assert.deepEqual(math.detectPower(source), {power:3,direction:"out"}, source);
    }
    assert.deepEqual(math.detectPower("x*x*x"), {power:3,direction:"in"});
    assert.deepEqual(math.detectPower("if(t <= .5,2^(1.539-1)*t^1.539,1-2^(1.539-1)*(1-t)^1.539)"), {power:1.539,direction:"in out",midpoint:0.5});
    assert.deepEqual(math.detectPower("var p := 4; x<.5 ? pow(2*x,p)/2 : 1-pow(2-2*x,p)/2"), {power:4,direction:"in out",midpoint:0.5});
});
test("Power detection recovers shifted Both midpoint and full typed precision", () => {
    const powers = [...Array.from({length:11}, (_,i)=>i+2), 1.001, 1.539, 2.71828182846, 7.12345678901, 11.999];
    for (const midpoint of [0.01, 0.2, 0.5, 0.8, 0.99, 0.123456789123, 0.345678901234]) for (const power of powers) {
        const source = math.powerExpression(power, "in out", midpoint);
        assert.deepEqual(math.detectPower(source), {power,direction:"in out",midpoint}, `${power} at ${midpoint}`);
    }
    for (const midpoint of [0.01, 0.2, 0.8, 0.99]) assert.deepEqual(math.detectPower(math.powerExpression(1,"in out",midpoint)), {power:1,direction:"in"});
});
test("shifted Both detection recognizes algebraic aliases and rejects unequal branches", () => {
    const aliases = [
        ["var s := .2; var p := 1.539; if(t<s,s*(t/s)^p,1-(1-s)*((1-t)/(1-s))^p)", 1.539, 0.2],
        ["x<=.8 ? pow(x,3)/pow(.8,2) : 1-pow(1-x,3)/pow(.2,2)", 3, 0.8],
        ["if(x<.01, x*x*x/.0001, 1-(1-x)^3/(.99*.99))", 3, 0.01],
        ["x<.99 ? .99*POW(x/.99,12) : 1-.01*POW((1-x)/.01,12)", 12, 0.99]
    ];
    for (const [source,power,midpoint] of aliases) assert.deepEqual(math.detectPower(source), {power,direction:"in out",midpoint}, source);
    for (const midpoint of [0.005, 0.995]) {
        const source = `x<${midpoint} ? ${midpoint}*pow(x/${midpoint},3) : 1-(1-${midpoint})*pow((1-x)/(1-${midpoint}),3)`;
        assert.equal(math.detectPower(source), null, source);
    }
    const custom = [
        "x<.2 ? .2*pow(x/.2,2) : 1-.8*pow((1-x)/.8,3)",
        "x<.8 ? .8*pow(x/.8,1.539) : 1-.2*pow((1-x)/.2,12)",
        "x<.01 ? .01*pow(x/.01,3)+.0001*sin(PI*100*x) : 1-.99*pow((1-x)/.99,3)",
        "(x<.2 ? .2*pow(x/.2,4) : 1-.8*pow((1-x)/.8,4)) + sin(PI*256*x)*.001"
    ];
    for (const source of custom) assert.equal(math.detectPower(source), null, source);
});
test("zero endpoint slopes preserve legacy expression bytes and directional controls", () => {
    for (const power of [1, 1.539, 3, 12]) for (const direction of ["in", "out", "in out"]) for (const midpoint of [0.01, 0.2, 0.5, 0.99]) {
        assert.equal(math.powerExpression(power, direction, midpoint, 0, 0), math.powerExpression(power, direction, midpoint));
        if (direction === "in") assert.equal(math.powerExpression(power, direction, midpoint, 0, 1), math.powerExpression(power, direction, midpoint));
        if (direction === "out") assert.equal(math.powerExpression(power, direction, midpoint, 1, 0), math.powerExpression(power, direction, midpoint));
        if (power === 1) assert.equal(math.powerExpression(power, direction, midpoint, 0.7, 0.3), "x");
    }
    assert.equal(math.powerExpression(3, "in", 0.5, 0, 0), "pow(x, 3)");
    assert.equal(math.powerExpression(3, "out", 0.5, 0, 0), "1 - pow(1 - x, 3)");
    assert.equal(math.powerExpression(3, "in out", 0.5, 0, 0), "x < 0.5 ? pow(2 * x, 3) / 2 : 1 - pow(2 * (1 - x), 3) / 2");
});
test("endpoint slopes strictly validate finite numeric bounds", () => {
    for (const invalid of [-0.001, 1.001, Infinity, NaN, null, "0.5", false, {}]) for (const direction of ["in", "out", "in out"]) for (const power of [1, 3]) {
        assert.throws(() => math.powerExpression(power, direction, 0.5, invalid, 0), /Endpoint slopes/);
        assert.throws(() => math.powerExpression(power, direction, 0.5, 0, invalid), /Endpoint slopes/);
    }
    for (const direction of ["in", "out", "in out"]) assert.ok(math.validate(math.powerExpression(3, direction, 0.5, 1, 1)).ok);
});
test("endpoint controls preserve normalization and monotonicity at power and midpoint limits", () => {
    const pairs = [[0, 0.2], [0.2, 0], [0.2, 0.7], [0.7, 0.2], [0.9, 0.9], [1, 0], [0, 1], [1, 0.7], [0.7, 1], [1, 1]];
    for (const power of [1.000001, 1.539, 2, 7, 12]) for (const midpoint of [0.01, 0.2, 0.5, 0.8, 0.99]) for (const [bottom, top] of pairs) {
        const fn = math.compile(math.powerExpression(power, "in out", midpoint, bottom, top));
        near(fn(0), 0, 1e-12); near(fn(1), 1, 1e-12); near(fn(midpoint), midpoint, 1e-12);
        const xs = Array.from({length:257}, (_,i)=>i/256);
        for (let i=0; i<=64; i++) xs.push(midpoint*i/64, 1-(1-midpoint)*i/64);
        xs.sort((a,b)=>a-b);
        let previous = -Infinity;
        for (const x of xs) {
            const value = fn(x);
            assert.ok(value >= -1e-12 && value <= 1+1e-12, `${power} at ${midpoint}: ${value}`);
            assert.ok(value >= previous-1e-12, `${power} at ${midpoint}, endpoints ${bottom}, ${top}`);
            previous = value;
        }
    }
    for (const direction of ["in", "out"]) for (const power of [1.539, 3, 12]) for (const endpoint of [0.01, 0.3, 0.9, 1]) {
        const points = math.sample(math.powerExpression(power, direction, 0.5, endpoint, endpoint), 257);
        near(points[0].y, 0); near(points[256].y, 1);
        for (let i=1; i<points.length; i++) assert.ok(points[i].y >= points[i-1].y-1e-12);
    }
});
test("endpoint slopes and the Both join have the requested continuous velocities", () => {
    for (const power of [1.539, 2, 7, 12]) for (const midpoint of [0.01, 0.2, 0.5, 0.99]) for (const [bottom, top] of [[0.2, 0.7], [0.7, 0.2], [1, 0], [0, 1], [1, 1]]) {
        const fn = math.compile(math.powerExpression(power, "in out", midpoint, bottom, top));
        const h = Math.min(midpoint, 1-midpoint)*1e-7;
        near((fn(h)-fn(0))/h, bottom, 3e-4);
        near((fn(1)-fn(1-h))/h, top, 3e-4);
        const left = (fn(midpoint)-fn(midpoint-h))/h;
        const right = (fn(midpoint+h)-fn(midpoint))/h;
        const expectedJoin = power-(power-1)*Math.max(bottom,top);
        near(left, expectedJoin, 1e-4); near(right, expectedJoin, 1e-4); near(left, right, 1e-4);
    }
    const h = 1e-8;
    near(math.compile(math.powerExpression(3,"in",0.5,0.3,0))(h)/h,0.3,1e-7);
    const outside = math.compile(math.powerExpression(3,"out",0.5,0,0.4));
    near((1-outside(1-h))/h,0.4,1e-7);
});
test("a linear endpoint branch retains the independently adjusted opposite branch", () => {
    const midpoint = 0.2;
    const bottomLinear = math.compile(math.powerExpression(3, "in out", midpoint, 1, 0.3));
    const topLinear = math.compile(math.powerExpression(3, "in out", midpoint, 0.3, 1));
    const bothLinear = math.compile(math.powerExpression(3, "in out", midpoint, 1, 1));
    for (let i=0; i<=20; i++) {
        const x = i/20;
        near(bottomLinear(midpoint*x), midpoint*x, 1e-12);
        near(topLinear(midpoint+(1-midpoint)*x), midpoint+(1-midpoint)*x, 1e-12);
        near(bothLinear(x), x, 1e-12);
    }
    assert.ok(bottomLinear(0.6)>0.6+0.01, "top slope remains effective when the bottom branch is linear");
    assert.ok(topLinear(0.1)<0.1-0.01, "bottom slope remains effective when the top branch is linear");
    const changedTop = math.compile(math.powerExpression(3,"in out",midpoint,1,0.7));
    assert.ok(Math.abs(bottomLinear(0.6)-changedTop(0.6))>0.01);
});
test("Power detection round-trips generated endpoints with full source precision", () => {
    for (const power of [1.539, 3, 12, 1.5392736412812]) for (const midpoint of [0.01, 0.5, 0.99, 0.3271293]) for (const [bottom, top] of [[0.2, 0], [0, 0.7], [0.2, 0.7], [1, 0], [0, 1], [1, 1], [0.237123456789123, 0.712345678912345]]) for (const direction of ["in", "out", "in out"]) {
        const source = math.powerExpression(power, direction, midpoint, bottom, top);
        const detected = math.detectPower(source);
        const expected = {power,direction};
        if (direction === "in out") expected.midpoint = midpoint;
        if (bottom !== 0 && direction !== "out") expected.bottom = bottom;
        if (top !== 0 && direction !== "in") expected.top = top;
        // A direction with zero relevant slope deliberately retains its legacy
        // formula and detector precision; generated endpoint declarations retain
        // all typed digits when those controls affect the curve.
        if (!expected.bottom && !expected.top) expected.power = Number(power.toPrecision(12));
        assert.deepEqual(detected, expected, `${power} ${direction} at ${midpoint}, ${bottom}, ${top}`);
    }
    assert.deepEqual(math.detectPower(math.powerExpression(1,"in out",0.2,1,1)), {power:1,direction:"in"});
});
test("endpoint recognition supports safe inline aliases and renamed constants", () => {
    const aliases = [
        [".3*x+.7*x^3", {power:3,direction:"in",bottom:0.3}],
        [".3*x+.7*x*x*x", {power:3,direction:"in",bottom:0.3}],
        ["1-(.4*(1-t)+.6*(1-t)^1.539)", {power:1.539,direction:"out",top:0.4}]
    ];
    for (const [source,expected] of aliases) assert.deepEqual(math.detectPower(source),expected,source);
    for (const midpoint of [0.01,0.2,0.99]) for (const power of [1.539,3,12]) for (const [bottom,top] of [[0.2,0.7],[1,0],[0,1]]) {
        const source = math.powerExpression(power,"in out",midpoint,bottom,top)
            .replace(/\bpower\b/g,"n").replace(/\bbottom\b/g,"b").replace(/\btop\b/g,"a")
            .replace(/\bmidpoint\b/g,"s").replace(/\bjoin\b/g,"j");
        const expected = {power,direction:"in out",midpoint};
        if (bottom) expected.bottom=bottom;
        if (top) expected.top=top;
        assert.deepEqual(math.detectPower(source),expected,source);
    }
});
test("endpoint metadata is verified and cannot disguise custom or discontinuous curves", () => {
    assert.deepEqual(math.detectPower("var power := 3; var bottom := .4; pow(x,3)"), {power:3,direction:"in"}, "unused metadata does not change the recognized curve");
    assert.deepEqual(math.detectPower("var power := 3; var bottom := .4; var midpoint := 0; pow(x,3)"), {power:3,direction:"in"}, "out-of-range hints do not suppress legacy recognition");
    const generated = math.powerExpression(3,"in out",0.2,0.3,0.7);
    const custom = [
        "var power := 3; var bottom := .4; -(cos(PI*x)-1)/2",
        "var power := 3; var bottom := x*.3; bottom*x+(1-bottom)*pow(x,power)",
        generated.replace("var maximum := max(bottom, top)", "var maximum := 0.4"),
        generated + "+.00001*sin(PI*256*x)",
        "var power := 3; var bottom := .2; var top := .7; var midpoint := .2; x < midpoint ? midpoint*(bottom*(x/midpoint)+(1-bottom)*(x/midpoint)^power) : 1-(1-midpoint)*(top*((1-x)/(1-midpoint))+(1-top)*((1-x)/(1-midpoint))^power)"
    ];
    for (const source of custom) assert.equal(math.detectPower(source),null,source);
});
test("Power detection conservatively rejects malformed, below-one and custom curves", () => {
    const invalid = [undefined,null,3,{},()=>0,""," ","x^","pow(x)","api.delete('all')","sqrt(-1)","1/(x-.5)","x+0.01", "0", "1", "x^0.999", "x^1e999"];
    for (const source of invalid) assert.equal(math.detectPower(source), null, String(source));
    const custom = ["x*x*(3-2*x)", "(pow(2,10*x)-1)/(pow(2,10)-1)", "-(cos(PI*x)-1)/2", "x+sin(PI*128*x)*.1", "x^3+sin(PI*256*x)*.02", "x+8*x*(1-x)*(.5-x)", "x<.5 ? x^2 : 1-(1-x)^3", "x^3 + 0.0000001*x*(1-x)"];
    for (const source of custom) assert.equal(math.detectPower(source), null, source);
    assert.equal(math.detectPower({bezier:math.fitBezier("x^10")}), null, "Bezier approximations are not expression strings");
    assert.equal(math.detectPower(math.compile("x^3")), null, "Callable curves are not inferred as expression metadata");
});
test("the slider limit is soft and higher typed powers round-trip without a second cap", () => {
    for (const power of [12.001, 12.5, 15.539, 20.539, 100, 1000, 10000, 20.5392736412812]) for (const direction of ["in","out","in out"]) for (const midpoint of [0.01,0.5,0.99]) {
        const source = math.powerExpression(power,direction,midpoint);
        const check = math.validate(source);
        assert.ok(check.ok,check.error);
        const expected={power,direction};
        if (direction==="in out") expected.midpoint=midpoint;
        assert.deepEqual(math.detectPower(source),expected,source);
        if (direction!=="in out") assert.deepEqual(math.detectPower(source.replace(/pow\((x|1 - x), ([\d.e+\-]+)\)/, "($1)^$2")),expected,source);
    }
    assert.deepEqual(math.detectPower("var n := 20.5392736412812; pow(t,n)"),{power:20.5392736412812,direction:"in"});
});
test("higher powers preserve weighted endpoints, shifted Both joins and exact metadata", () => {
    for (const power of [12.5,20.539,100,1000,10000,100.123456789123]) for (const midpoint of [0.01,0.2,0.99]) for (const [bottom,top] of [[0.2,0.7],[0.7,0.2],[1,0],[0,1],[1,1]]) for (const direction of ["in","out","in out"]) {
        const source=math.powerExpression(power,direction,midpoint,bottom,top),fn=math.compile(source);
        const expected={power,direction};
        if(direction==="in out")expected.midpoint=midpoint;
        if(bottom&&direction!=="out")expected.bottom=bottom;
        if(top&&direction!=="in")expected.top=top;
        assert.deepEqual(math.detectPower(source),expected,source);
        near(fn(0),0,1e-12);near(fn(1),1,1e-12);
        const xs=Array.from({length:129},(_,i)=>i/128);
        for(const decay of [0.01,0.13,0.7,1.9,5.3,13.7]) {
            const u=Math.exp(-decay/power);
            if(direction==="in out")xs.push(midpoint*u,1-(1-midpoint)*u);
            else xs.push(direction==="out"?1-u:u);
        }
        xs.sort((a,b)=>a-b);
        let previous=-Infinity;
        for(const x of xs){const value=fn(x);assert.ok(value>=previous-1e-10);assert.ok(value>=-1e-10&&value<=1+1e-10);previous=value;}
        if(direction==="in out") {
            near(fn(midpoint),midpoint,1e-12);
            const h=Math.min(midpoint,1-midpoint)*1e-6/power,join=power-(power-1)*Math.max(bottom,top);
            near((fn(midpoint)-fn(midpoint-h))/h,join,Math.max(1e-3,power*1e-5));
            near((fn(midpoint+h)-fn(midpoint))/h,join,Math.max(1e-3,power*1e-5));
        }
    }
});
test("high-power aliases recognize weighted and expanded polynomial families", () => {
    for(const power of [12.5,20.539,100,10000]) {
        assert.deepEqual(math.detectPower(`.3*x+.7*x^${power}`),{power,direction:"in",bottom:0.3});
        assert.deepEqual(math.detectPower(`1-(.4*(1-x)+.6*(1-x)^${power})`),{power,direction:"out",top:0.4});
        for(const midpoint of [0.01,0.2,0.99]) {
            const source=math.powerExpression(power,"in out",midpoint,0.2,0.7)
                .replace(/\bpower\b/g,"n").replace(/\bbottom\b/g,"b").replace(/\btop\b/g,"a")
                .replace(/\bmidpoint\b/g,"s").replace(/\bjoin\b/g,"j");
            assert.deepEqual(math.detectPower(source),{power,direction:"in out",midpoint,bottom:0.2,top:0.7});
        }
    }
    for(const power of [13,20,100]) {
        const multiplied=Array(power).fill("x").join("*");
        assert.deepEqual(math.detectPower(`.3*x+.7*${multiplied}`),{power,direction:"in",bottom:0.3});
    }
});
test("high-power verification samples the transition rather than trusting underflow", () => {
    assert.deepEqual(math.detectPower("var power := 10000; var bottom := .3; bottom*x+(1-bottom)*pow(x,20000)"),{power:20000,direction:"in",bottom:0.3});
    assert.equal(math.detectPower("var power := 10000; var bottom := .3; x=1 ? 1 : bottom*x"),null,"A step-like custom curve cannot borrow a high exponent");
    const source=math.powerExpression(10000,"in out",0.01,0.2,0.7);
    assert.equal(math.detectPower(source.replace("var maximum := max(bottom, top)","var maximum := 0")),null,"The high-power join correction is checked near its transition");
    assert.equal(math.validate("pow(2,10000)*pow(x,10000)").ok,false,"Non-finite algebraic aliases fail ordinary validation");
});
test("extremely large finite powers are evaluated safely without arbitrary rejection", () => {
    for(const power of [1e20,1e100,Number.MAX_VALUE]) for(const direction of ["in","out","in out"]) for(const midpoint of [0.01,0.5,0.99]) for(const [bottom,top] of [[0,0],[0.2,0.7],[1,0],[0,1],[1,1]]) {
        const source=math.powerExpression(power,direction,midpoint,bottom,top),check=math.validate(source);
        assert.ok(check.ok,check.error);
        const expected={power,direction};if(direction==="in out")expected.midpoint=midpoint;
        if(bottom&&direction!=="out")expected.bottom=bottom;if(top&&direction!=="in")expected.top=top;
        assert.deepEqual(math.detectPower(source),expected,source);
        let previous=-Infinity;
        for(const point of math.sample(source)){assert.ok(point.y>=previous-1e-10);assert.ok(point.y>=-1e-10&&point.y<=1+1e-10);previous=point.y;}
    }
});
test("large weighted Both coefficients preserve the join residual and linear endpoint", () => {
    for(const power of [2**54,1e100,Number.MAX_VALUE]) for(const [bottom,top] of [[1,0],[0,1],[1,1]]) {
        const source=math.powerExpression(power,"in out",0.2,bottom,top);
        const declarations=source.slice(0,source.lastIndexOf(";")+1);
        near(math.compile(declarations+"join")(0),1,0,"A maximum weight retains join velocity 1 above floating-point integer precision");
        const endpoint=bottom===1?"bottom":"top";
        near(math.compile(declarations+"(power - 1) * (maximum - "+endpoint+")")(0),0,0,"The linear branch correction stays exactly zero");
    }
});
test("ExprTk implicit multiplication and additional documented math functions", () => {
    near(math.compile("2x + 3(x+1)")(0.5), 5.5);
    near(math.compile("sin(x)cos(x)")(0.5), Math.sin(0.5) * Math.cos(0.5));
    near(math.compile("var c := 2; c(x + 1)")(0.5), 3);
    near(math.compile("(x+1)2")(0.5), 3);
    near(math.compile("logn(8, 2)")(0), 3);
    near(math.compile("sinc(0)")(0), 1);
    near(math.compile("deg2rad(180)")(0), Math.PI);
    near(math.compile("expm1(0.00001)")(0), Math.expm1(0.00001), 1e-16);
    near(math.compile("log1p(0.00001)")(0), Math.log1p(0.00001), 1e-16);
    near(math.compile("avg(1, 2, 3) + sum(1, 2) + mul(2, 3)")(0), 11);
    near(math.compile("E")(0), Math.E);
    assert.ok(math.compile("ln(x)+sign(x)").expression.includes("log"));
});
test("sampling preserves finite overshoot and rejects poles/nonfinite expressions", () => {
    const points = math.sample("x + sin(PI * x) * 2", 129);
    assert.equal(points.length, 129); near(points[0].x, 0); near(points[128].x, 1);
    assert.ok(Math.max(...points.map(p => p.y)) > 2);
    assert.equal(math.validate("1 / (x - 0.5)").ok, false);
    assert.equal(math.validate("sqrt(-1)").ok, false);
    assert.throws(() => math.compile("1e999"), /Non-finite/);
});
test("safe bounded parser rejects JavaScript and unsupported ExprTk constructs", () => {
    const invalid = ["api.delete('all')", "this.constructor.constructor('return globalThis')()", "Math.pow(x, 3)", "x[0]", "x; api.runProcess()", "var x := 4; x", "var __proto__ := 3; x", "while(x) {x=1}", "x := 2", "unknown(x)", "x + missing", "pow(x)"];
    for (const expression of invalid) assert.equal(math.validate(expression).ok, false, expression);
    assert.equal(math.validate("(".repeat(150) + "x" + ")".repeat(150)).ok, false);
    assert.equal(math.validate("-".repeat(150) + "x").ok, false);
});
test("exact cubic Bezier conversion, including negative/overshoot handles", () => {
    for (const expression of ["x", "x^3", "1-(1-x)^3", "x + 8*x*(1-x)*(0.5-x)"]) {
        const fn = math.compile(expression), fit = math.fitBezier(fn, {optimizeX: false});
        near(fit.x1, 1 / 3); near(fit.x2, 2 / 3);
        assert.ok(fit.maxError < 1e-8, expression + " has an exact cubic representation");
        for (let i = 0; i <= 20; i++) near(math.bezierValue(i / 20, fit), fn(i / 20), 1e-8);
    }
    const fit = math.fitBezier("x^3"); near(fit.y1, 0, 1e-8); near(fit.y2, 0, 1e-8);
});
test("free x fitting improves high powers and reports approximation error", () => {
    const source = "x^10";
    const fixed = math.fitBezier(source, {optimizeX: false});
    const fitted = math.fitBezier(source);
    assert.ok(fitted.rmsError < fixed.rmsError * 0.5, "free x handles improve the fit");
    assert.ok(fitted.maxError > 0, "a non-cubic expression is reported as approximate");
    assert.ok(fitted.x1 > 0 && fitted.x1 < 1 && fitted.x2 > 0 && fitted.x2 < 1);
    const noncanonical = math.fitBezier("x+0.2"); near(noncanonical.endpointMismatch, 0.2);
    const oscillating = math.fitBezier("x + sin(PI*6*x)*0.3"); assert.ok(oscillating.maxError > 0.1);
});
test("inverse x Bezier evaluation handles steep, crossed and boundary x handles", () => {
    for (const xPair of [[0, 0], [1, 1], [1, 0], [0.8, 0.2], [0.1, 0.9]]) {
        const handles = {x1: xPair[0], y1: xPair[0], x2: xPair[1], y2: xPair[1]};
        for (let i = 0; i <= 100; i++) near(math.bezierValue(i / 100, handles), i / 100, 1e-8);
    }
});
test("large finite overshoot is fitted without squaring into Infinity", () => {
    const fn = math.compile("x + 1e200*x*(1-x)");
    const fit = math.fitBezier(fn, {optimizeX: false});
    assert.ok(Number.isFinite(fit.rmsError)); assert.ok(Number.isFinite(fit.y1));
    for (let i = 1; i < 20; i++) assert.ok(Math.abs(math.bezierValue(i / 20, fit) / fn(i / 20) - 1) < 1e-8);
});

let failed = 0;
for (const {name, fn} of tests) {
    try { fn(); process.stdout.write("PASS " + name + "\n"); }
    catch (error) { failed++; process.stderr.write("FAIL " + name + "\n" + error.stack + "\n"); }
}
if (failed) process.exitCode = 1;
else process.stdout.write(`${tests.length} test groups passed.\n`);
