  var x: array<vec4f, 2>;
  x[0] = vec4f(tangent, view.x);
  x[1] = vec4f(view.yz, dot(tangent, view), 1.0);
  let v_ = veilAt(i, t);
  let L = run_strand(&x);
  let key = dot(L[0] * v_.x, vec3f(0.3, 0.6, 0.1));
  let c = L[1] * v_.y + L[2] * v_.z;

