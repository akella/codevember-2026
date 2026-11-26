"""render_hero.py, of the studio's cocoon (studio.py): its name is how that knows.  blender -b -P render_studio.py -- data --views 1500"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["SUBJECT"] = "studio"
import render_hero  # noqa: E402

render_hero.main()
