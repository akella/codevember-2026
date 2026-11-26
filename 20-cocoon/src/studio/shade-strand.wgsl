  var x: array<vec4f, 2>;
  x[0] = vec4f(tangent, view.x);
  x[1] = vec4f(view.yz, dot(tangent, view), 1.0);
  var c = shaded(run_strand(&x), veilAt(i, t));
  // the network knows strands alone in the dark: near a cocoon its silk lights them too
  let here = place(p);
  for (var o = 0u; o < 3u; o++) {
    let b = shadow.now[o];
    let q = vec3f(dot(b.x.xyz, here) + b.x.w, dot(b.y.xyz, here) + b.y.w, dot(b.z.xyz, here) + b.z.w);
    let n = normalize(b.x.xyz * q.x + b.y.xyz * q.y + b.z.xyz * q.z);
    let off = max(length(q) - 1.0, 0.0) * 0.7;
    let near = exp(-off * 5.0) * 0.5;
    for (var l = 0u; l < 3u; l++) { c += shadow.colours[l].rgb * near * shadow.look.w * max(dot(n, shadow.lamps[l].xyz) * 0.8 + 0.2, 0.0); }
  }
