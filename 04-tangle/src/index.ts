import { failed, reveal } from "./loading";
import createPiece from "./piece";

createPiece()
  .then(async (stage) => {
    await stage.start();
    await reveal();
  })
  .catch(failed);
