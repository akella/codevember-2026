  var x: array<vec4f, 2>;
  x[0] = vec4f(tangent, view.x);
  x[1] = vec4f(view.yz, dot(tangent, view), 1.0);
  let c = shaded(run_strand(&x), veilAt(i, t));
