export type DemoKey = {
  sequence: number;
  clue: string;
  answer: string;
  status: "locked" | "current" | "solved";
  enteredWord: string;
};

export type DemoContestState = {
  contestId: string;
  title: string;
  prize: string;
  status: "ACTIVE" | "COMPLETED";
  currentSequence: number | null;
  solvedCount: number;
  incorrectAttempts: number;
  keys: DemoKey[];
};

const DEMO_CONTEST_ID = "demo-contest";
const STORAGE_KEY = "walletFindDemoState";

const DEMO_WORDS = [
  "apple",
  "moon",
  "river",
  "forest",
  "gold",
  "bridge",
  "window",
  "light",
  "mountain",
  "shadow",
  "garden",
  "bitcoin",
];

const DEMO_CLUES = [
  "A fruit that keeps the doctor away.",
  "The natural satellite of Earth.",
  "Water flowing toward the sea.",
  "A large area covered mainly with trees.",
  "A precious yellow metal.",
  "A structure built to cross a river or road.",
  "An opening in a wall fitted with glass.",
  "The opposite of darkness.",
  "A very high natural elevation.",
  "A dark shape produced by blocking light.",
  "A place where flowers and plants are grown.",
  "A well-known cryptocurrency.",
];

function createInitialState(): DemoContestState {
  return {
    contestId: DEMO_CONTEST_ID,
    title: "12Keys Demo Contest",
    prize: "500 ₮",
    status: "ACTIVE",
    currentSequence: 1,
    solvedCount: 0,
    incorrectAttempts: 0,
    keys: DEMO_WORDS.map((answer, index) => ({
      sequence: index + 1,
      clue: DEMO_CLUES[index],
      answer,
      status: index === 0 ? "current" : "locked",
      enteredWord: "",
    })),
  };
}

export function loadDemoContest(): DemoContestState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createInitialState();

  try {
    const parsed = JSON.parse(raw) as DemoContestState;
    if (!Array.isArray(parsed.keys) || parsed.keys.length !== 12) {
      return createInitialState();
    }
    return parsed;
  } catch {
    return createInitialState();
  }
}

function save(state: DemoContestState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetDemoContest(): DemoContestState {
  const state = createInitialState();
  save(state);
  return state;
}

export function submitDemoAnswer(
  sequence: number,
  answer: string,
): { state: DemoContestState; isCorrect: boolean; message: string } {
  const state = loadDemoContest();
  const current = state.keys.find((key) => key.sequence === state.currentSequence);

  if (!current || current.sequence !== sequence) {
    return {
      state,
      isCorrect: false,
      message: "این کلید در حال حاضر قابل پاسخ نیست.",
    };
  }

  const normalized = answer.trim().toLocaleLowerCase();
  current.enteredWord = answer;

  if (normalized !== current.answer) {
    state.incorrectAttempts += 1;
    save(state);
    return {
      state,
      isCorrect: false,
      message: "پاسخ اشتباه است؛ همچنان در همین کلید بمان.",
    };
  }

  current.status = "solved";
  state.solvedCount += 1;

  const next = state.keys.find((key) => key.sequence === sequence + 1);
  if (next) {
    next.status = "current";
    state.currentSequence = next.sequence;
  } else {
    state.currentSequence = null;
    state.status = "COMPLETED";
  }

  save(state);

  return {
    state,
    isCorrect: true,
    message: next
      ? "پاسخ صحیح است؛ کلید بعدی باز شد."
      : "تبریک! هر ۱۲ کلید را حل کردی.",
  };
}
