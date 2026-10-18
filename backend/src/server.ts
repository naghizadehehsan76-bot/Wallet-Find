import "dotenv/config";
import app from "./app.js";
import { startContestScheduler } from "./modules/contest/contest-scheduler.service.js";
import { ensureMvpActiveContest } from "./modules/contest/mvp-contest-seed.service.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  void ensureMvpActiveContest().catch((error) => {
    console.error("Failed to ensure a playable MVP contest", error);
  });
  startContestScheduler();
});
