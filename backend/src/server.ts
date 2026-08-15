import "dotenv/config";
import app from "./app.js";
import { startContestScheduler } from "./modules/contest/contest-scheduler.service.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startContestScheduler();
});
