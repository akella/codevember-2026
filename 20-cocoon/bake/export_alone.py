# /// script
# requires-python = ">=3.11"
# dependencies = ["torch", "numpy", "OpenEXR", "pillow"]
# ///
"""export.py for the cocoons on their own -> ../public/alone/.  uv run export_alone.py"""

import alone as A  # noqa: F401  (moves the cocoons)
import export as E
import train_alone

if __name__ == "__main__":
    T, Alone = train_alone.model_class()
    T.DATA, T.Cocoon = train_alone.RUN, Alone
    E.T, E.OUT = T, E.OUT / "alone"
    E.main()
