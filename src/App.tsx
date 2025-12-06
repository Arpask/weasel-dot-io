import { useEffect, useMemo, useRef, useState } from "react";
import "./app.css";

/** ------------ Types ------------ */
type Task = { id: string; name: string; targetSec: number };
type TaskStatus =
  | "incomplete"
  | "complete_at"
  | "complete_under"
  | "complete_over"
  | "skipped";
type TaskResult = { status: TaskStatus; actualSec: number | null };
type EditingValues = { id: string; name: string; timeStr: string };
type SavedSequence = {
  id: string;
  name: string;
  tasks: Task[];
  chain: string[];
  roundsCount: number;
  savedAt: number;
};

/** ------------ Initial Data ------------ */
const INITIAL_TASKS: Task[] = [
  { id: "t1", name: "Task 1", targetSec: 180 },
  { id: "t2", name: "Task 2", targetSec: 300 },
  { id: "t3", name: "Task 3", targetSec: 180 },
];
const INITIAL_CHAIN: string[] = ["t1", "t2", "t3"];

/** ------------ Helpers ------------ */
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${String(h)}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${String(m)}:${String(r).padStart(2, "0")}`;
};
const parseTime = (timeStr: string): number => {
  const parts = timeStr.split(":").map((part) => parseInt(part, 10));
  let seconds = 0;
  if (parts.length === 1) seconds = parts[0] || 0;
  else if (parts.length === 2) seconds = parts[0] * 60 + (parts[1] || 0);
  else if (parts.length > 2)
    seconds = parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
  return Math.max(0, seconds);
};

/** Generate a unique ID (fallback for crypto.randomUUID) */
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  // Fallback: simple unique ID generator
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/** Pie chart component for progress visualization */
const PieChart = ({
  segments,
  currentIndex,
  size = 60,
  getSegmentColor,
  segmentValues,
}: {
  segments: number;
  currentIndex: number;
  size?: number;
  getSegmentColor: (index: number) => string;
  segmentValues?: number[]; // Optional array of values for proportional sizing
}) => {
  const center = size / 2;
  const radius = size / 2 - 2;

  // Calculate angles based on values or equal distribution
  const angles = (() => {
    if (segmentValues && segmentValues.length === segments) {
      const total = segmentValues.reduce((sum, val) => sum + val, 0);
      let currentAngle = 0;
      return segmentValues.map((val) => {
        const startAngle = currentAngle;
        const angleSize = (val / total) * 2 * Math.PI;
        currentAngle += angleSize;
        return { startAngle, endAngle: currentAngle };
      });
    } else {
      // Equal distribution
      const anglePerSegment = (2 * Math.PI) / segments;
      return Array.from({ length: segments }).map((_, i) => ({
        startAngle: i * anglePerSegment,
        endAngle: (i + 1) * anglePerSegment,
      }));
    }
  })();

  const createArc = (startAngle: number, endAngle: number) => {
    // Handle full circle case - draw it slightly less than full to make it visible
    const angleDiff = endAngle - startAngle;
    if (angleDiff >= 2 * Math.PI - 0.001) {
      // Draw a circle instead
      return `M ${center} ${
        center - radius
      } A ${radius} ${radius} 0 1 1 ${center} ${
        center + radius
      } A ${radius} ${radius} 0 1 1 ${center} ${center - radius} Z`;
    }

    const x1 = center + radius * Math.cos(startAngle - Math.PI / 2);
    const y1 = center + radius * Math.sin(startAngle - Math.PI / 2);
    const x2 = center + radius * Math.cos(endAngle - Math.PI / 2);
    const y2 = center + radius * Math.sin(endAngle - Math.PI / 2);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    return `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {angles.map(({ startAngle, endAngle }, i) => {
        const colorClass =
          i <= currentIndex ? getSegmentColor(i) : "incomplete";

        return (
          <path
            key={i}
            d={createArc(startAngle, endAngle)}
            className={`pie-segment ${colorClass}`}
            stroke="#fff"
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
};

/** Small beep using Web Audio when time hits zero */
const ring = () => {
  try {
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const t = ctx.currentTime;

    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      const startTime = t + i * 0.4;
      g.gain.setValueAtTime(0.0001, startTime);
      g.gain.exponentialRampToValueAtTime(0.6, startTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.3);
      o.start(startTime);
      o.stop(startTime + 0.35);
    }
  } catch {
    /* no-op */
  }
};

/** Pleasant chime for task completion */
const chime = () => {
  try {
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const t = ctx.currentTime;

    const playNote = (freq: number, startTime: number, gainPeak = 0.2) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);

      g.gain.setValueAtTime(0.0001, startTime);
      g.gain.exponentialRampToValueAtTime(gainPeak, startTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.25);
      o.start(startTime);
      o.stop(startTime + 0.3);
    };

    playNote(880, t);
    playNote(1108.73, t + 0.1);
  } catch {
    /* no-op */
  }
};

/** ------------ Sound effect suite ------------ */
const sweep = (
  startHz: number,
  endHz: number,
  duration = 0.12,
  type: OscillatorType = "sine",
  gainPeak = 0.08
) => {
  try {
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = type;
    o.connect(g);
    g.connect(ctx.destination);

    const t = ctx.currentTime;
    o.frequency.setValueAtTime(startHz, t);
    o.frequency.linearRampToValueAtTime(endHz, t + duration);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gainPeak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    o.start(t);
    o.stop(t + duration + 0.02);
  } catch {
    /* no-op */
  }
};

const playIncrease = () => sweep(660, 960, 0.12, "sine", 0.08);
const playDecrease = () => sweep(700, 420, 0.12, "sine", 0.08);
const playStart = () => sweep(440, 660, 0.1, "sine", 0.06);
const playPause = () => sweep(660, 440, 0.1, "sine", 0.06);
const playNav = () => sweep(800, 550, 0.1, "sine", 0.05);
const playRestartSound = () => sweep(900, 300, 0.15, "sine", 0.07);
const playFocusToggle = () => sweep(300, 900, 0.1, "triangle", 0.04);

const playSessionComplete = () => {
  try {
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const t = ctx.currentTime;

    const playNote = (freq: number, startTime: number, gainPeak = 0.15) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);

      g.gain.setValueAtTime(0.0001, startTime);
      g.gain.exponentialRampToValueAtTime(gainPeak, startTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.25);
      o.start(startTime);
      o.stop(startTime + 0.3);
    };

    playNote(523.25, t);
    playNote(659.25, t + 0.1);
    playNote(783.99, t + 0.2);
    playNote(1046.5, t + 0.3);
  } catch {
    /* no-op */
  }
};

/** ------------------------------------------------------------------------- */

export default function App() {
  const [isLoading, setIsLoading] = useState(true);

  // Preload button icons and show loading screen until ready
  useEffect(() => {
    const iconPaths = [
      "/repeat-icon.svg",
      "/pause-icon.svg",
      "/play-icon.svg",
      "/done-icon.svg",
      "/weasel-logo-newer-png-small.png",
    ];

    const startTime = Date.now();
    const minLoadingTime = 1500;

    let loadedCount = 0;
    const totalIcons = iconPaths.length;

    // Create a hidden container to force browser to cache images
    const hiddenContainer = document.createElement("div");
    hiddenContainer.style.position = "absolute";
    hiddenContainer.style.left = "-9999px";
    hiddenContainer.style.top = "-9999px";
    document.body.appendChild(hiddenContainer);

    const finishLoading = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minLoadingTime - elapsed);

      setTimeout(() => {
        setIsLoading(false);
        // Keep the hidden container in the DOM to maintain cache
      }, remaining + 500);
    };

    iconPaths.forEach((path) => {
      const img = new Image();
      img.onload = () => {
        loadedCount++;
        // Add loaded image to hidden container
        hiddenContainer.appendChild(img);
        if (loadedCount === totalIcons) {
          finishLoading();
        }
      };
      img.onerror = () => {
        loadedCount++;
        if (loadedCount === totalIcons) {
          finishLoading();
        }
      };
      img.src = path;
    });

    // Cleanup function
    return () => {
      if (hiddenContainer.parentNode) {
        hiddenContainer.parentNode.removeChild(hiddenContainer);
      }
    };
  }, []);

  /** ------- Tasks/Chain ------- */
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [chain, setChain] = useState<string[]>(INITIAL_CHAIN);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const byId = (id: string) => tasks.find((t) => t.id === id)!;

  /** ------- Rounds / Results ------- */
  const [roundsCount, setRoundsCount] = useState<number>(3);
  const [rounds, setRounds] = useState<TaskResult[][]>(() =>
    Array.from({ length: 3 }, () =>
      INITIAL_CHAIN.map(() => ({ status: "incomplete", actualSec: null }))
    )
  );

  const isSkipped = (rIdx: number, i: number) =>
    (rounds[rIdx]?.[i]?.status ?? "incomplete") === "skipped";

  const roundTargetSec = (rIdx: number) =>
    chain.reduce(
      (sum, id, i) => sum + (isSkipped(rIdx, i) ? 0 : byId(id).targetSec),
      0
    );

  const sessionTargetSec = () =>
    Array.from({ length: roundsCount }).reduce(
      (s: number, _: unknown, r: number) => s + roundTargetSec(r),
      0
    );

  const [focusMode, setFocusMode] = useState(false);
  const timerAreaRef = useRef<HTMLDivElement | null>(null);
  const justFinishedEditingRef = useRef(false);
  const handleTimerAreaClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const interactiveTags = new Set([
      "BUTTON",
      "A",
      "INPUT",
      "TEXTAREA",
      "SELECT",
      "LABEL",
      "OPTION",
    ]);
    let node = e.target as HTMLElement | null;
    while (node && node !== timerAreaRef.current) {
      if (
        interactiveTags.has(node.tagName) ||
        (node as any).dataset?.nocapture === "true"
      )
        return;
      node = node.parentElement;
    }
    // Don't toggle focus mode if we just finished editing
    if (justFinishedEditingRef.current) {
      justFinishedEditingRef.current = false;
      return;
    }
    playFocusToggle();
    setFocusMode((f) => !f);
  };

  /** ------- Position ------- */
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);

  /** ------- Timer / Run state ------- */
  type RunState = "idle" | "running" | "paused";
  const [runState, setRunState] = useState<RunState>("idle");
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  const taskStartMs = useRef<number | null>(null);
  const pausedOffsetMs = useRef<number>(0);

  const [showSettings, setShowSettings] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [sequenceName, setSequenceName] = useState("");
  const [lastSavedSequenceId, setLastSavedSequenceId] = useState<string | null>(
    null
  );
  const [savedSequences, setSavedSequences] = useState<SavedSequence[]>([]);
  const [showSavedAlert, setShowSavedAlert] = useState(false);
  const [editingSequenceId, setEditingSequenceId] = useState<string | null>(
    null
  );

  // Load saved sequences from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("weaselTimerSequences");
    if (saved) {
      try {
        setSavedSequences(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load sequences:", e);
      }
    }
  }, []);

  // Save sequences to localStorage
  const saveSequencesToStorage = (sequences: SavedSequence[]) => {
    localStorage.setItem("weaselTimerSequences", JSON.stringify(sequences));
    setSavedSequences(sequences);
  };

  // Draft copy for Save Sequence modal (names, times, and order)
  const [draftChain, setDraftChain] = useState<string[]>([]);
  const [draftById, setDraftById] = useState<
    Record<string, { name: string; targetSec: number }>
  >({});
  const [draftRoundsCount, setDraftRoundsCount] = useState(3);
  const [editingModalTask, setEditingModalTask] = useState<{
    id: string;
    field: "name" | "time";
  } | null>(null);
  const modalDragFrom = useRef<number | null>(null);

  // Seed modal drafts when it opens
  useEffect(() => {
    if (showSaveModal) {
      setDraftChain([...chain]);
      const next: Record<string, { name: string; targetSec: number }> = {};
      tasks.forEach(
        (t) => (next[t.id] = { name: t.name, targetSec: t.targetSec })
      );
      setDraftById(next);
      setDraftRoundsCount(roundsCount);
      setEditingModalTask(null);
    }
  }, [showSaveModal, chain, tasks, roundsCount]);
  const [autocontinue, setAutocontinue] = useState(false);
  const [rollover, setRollover] = useState(false);
  const [rightArrowAction, setRightArrowAction] = useState<"skip" | "done">(
    "skip"
  );
  const autoLatchRef = useRef(false);

  const [rolloverOffsetSec, setRolloverOffsetSec] = useState(0);
  const [showRolloverToast, setShowRolloverToast] = useState<number | null>(
    null
  );
  const [weaselJump, setWeaselJump] = useState(false);
  const nextRolloverRef = useRef(0);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 25);
    return () => clearInterval(id);
  }, []);

  /** ------- Derived current task/time ------- */
  const currentTaskId = chain[currentTaskIndex];
  const currentTask = byId(currentTaskId);
  const effectiveTargetSec = currentTask.targetSec + rolloverOffsetSec;

  const nowMs = Date.now();
  const elapsedMs =
    runState === "running"
      ? taskStartMs.current
        ? nowMs - taskStartMs.current
        : 0
      : pausedOffsetMs.current;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const remainingTaskSec = Math.max(0, effectiveTargetSec - elapsedSec);

  /** ------- Overtime ------- */
  const isOvertime = elapsedSec > effectiveTargetSec;
  const [overtimeBlink, setOvertimeBlink] = useState(true);
  const [hasRang, setHasRang] = useState(false);

  useEffect(() => {
    if (!isOvertime) {
      setOvertimeBlink(true);
      return;
    }
    const id = window.setInterval(() => setOvertimeBlink((b) => !b), 500);
    return () => window.clearInterval(id);
  }, [isOvertime]);

  useEffect(() => {
    if (runState === "running" && remainingTaskSec === 0 && !hasRang) {
      ring();
      setHasRang(true);
    }
  }, [remainingTaskSec, runState, hasRang]);

  useEffect(() => {
    setHasRang(false);
    autoLatchRef.current = false;
  }, [currentTaskIndex, currentRoundIndex]);

  useEffect(() => {
    setRolloverOffsetSec(nextRolloverRef.current);
  }, [currentTaskIndex, currentRoundIndex]);

  const roundElapsedActual =
    rounds[currentRoundIndex]?.reduce((s, t) => s + (t?.actualSec || 0), 0) || 0;

  const curRoundTarget = useMemo(
    () => roundTargetSec(currentRoundIndex),
    [rounds, tasks, chain, currentRoundIndex]
  );
  const fullSessionTarget = useMemo(
    () => sessionTargetSec(),
    [rounds, tasks, chain, roundsCount]
  );

  const roundRemainingSec = Math.max(
    0,
    curRoundTarget - (roundElapsedActual + elapsedSec)
  );
  const sessionElapsedActual =
    rounds
      .slice(0, currentRoundIndex)
      .flat()
      .reduce((s, t) => s + (t.actualSec || 0), 0) || 0;
  const sessionRemainingSec = Math.max(
    0,
    fullSessionTarget - (sessionElapsedActual + roundElapsedActual + elapsedSec)
  );

  type LightColor = "gray" | "yellow" | "red" | "orange" | "green";

  const taskLightColor = (i: number): LightColor => {
    const res = rounds[currentRoundIndex]?.[i];
    const target = byId(chain[i]).targetSec;
    if (res?.status === "skipped") return "gray";
    if (i < currentTaskIndex) {
      if (!res || res.status === "incomplete") return "gray";
      if (res.status === "complete_over") return "orange";
      return "green";
    }
    if (i === currentTaskIndex) {
      if (runState === "idle") return "gray";
      return elapsedSec > target ? "red" : "yellow";
    }
    return "gray";
  };

  const roundLightColor = (rIdx: number): LightColor => {
    if (rIdx > currentRoundIndex) return "gray";
    const targetForRound = roundTargetSec(rIdx);

    // Check if this round is complete (past rounds OR current round with all tasks done)
    if (rIdx <= currentRoundIndex) {
      const row = rounds[rIdx] ?? [];
      const anyIncomplete = row.some((t) => t.status === "incomplete");

      // If all tasks in this round are complete, color based on performance
      if (!anyIncomplete) {
        const actual = row.reduce((s, t) => s + (t.actualSec ?? 0), 0);
        return actual > targetForRound ? "orange" : "green";
      }
    }

    // For incomplete current round
    if (rIdx === currentRoundIndex) {
      if (runState === "idle") return "gray";
      const spent = roundElapsedActual + elapsedSec;
      return spent > targetForRound ? "red" : "yellow";
    }

    return "gray";
  };

  const [pulseRound, setPulseRound] = useState(false);
  const [pulseTotal, setPulseTotal] = useState(false);
  const triggerRoundPulse = () => {
    setPulseRound(false);
    requestAnimationFrame(() => setPulseRound(true));
  };
  const triggerTotalPulse = () => {
    setPulseTotal(false);
    requestAnimationFrame(() => setPulseTotal(true));
  };

  const [showRoundToast, setShowRoundToast] = useState(false);
  const [roundToastText, setRoundToastText] = useState("Round complete!");
  const triggerRoundToast = (text?: string) => {
    setRoundToastText(text ?? "Round complete!");
    setShowRoundToast(false);
    requestAnimationFrame(() => setShowRoundToast(true));
  };

  const startOrResume = () => {
    if (runState === "running") return;
    setRunState("running");
    const alreadyElapsed = pausedOffsetMs.current;
    taskStartMs.current = Date.now() - alreadyElapsed;
    playStart();
  };

  const pauseAll = () => {
    if (runState !== "running") {
      setRunState("paused");
      return;
    }
    setRunState("paused");
    pausedOffsetMs.current = elapsedMs;
    taskStartMs.current = null;
    playPause();
  };

  const restartCurrent = () => {
    playRestartSound();
    pausedOffsetMs.current = 0;
    taskStartMs.current = Date.now();
    setRunState("running");
    setRounds((prev) => {
      const copy = prev.map((r) => r.map((t) => ({ ...t })));
      copy[currentRoundIndex][currentTaskIndex] = {
        status: "incomplete",
        actualSec: null,
      };
      return copy;
    });
    setHasRang(false);
    autoLatchRef.current = false;
  };

  const completeCurrentTask = (actualSec: number) => {
    const target = currentTask.targetSec;
    const clamped = Math.max(0, Math.floor(actualSec));
    const status: TaskStatus =
      clamped < target
        ? "complete_under"
        : clamped === target
        ? "complete_at"
        : "complete_over";
    setRounds((prev) => {
      const copy = prev.map((r) => r.map((t) => ({ ...t })));
      copy[currentRoundIndex][currentTaskIndex] = {
        status,
        actualSec: clamped,
      };
      return copy;
    });
  };

  const markSkipped = (rIdx: number, tIdx: number) => {
    setRounds((prev) => {
      const copy = prev.map((r) => r.map((t) => ({ ...t })));
      copy[rIdx][tIdx] = { status: "skipped", actualSec: 0 };
      return copy;
    });
  };

  const goToTask = (roundIdx: number, taskIdx: number) => {
    const clampedRound = clamp(roundIdx, 0, Math.max(0, roundsCount - 1));
    const clampedTask = clamp(taskIdx, 0, Math.max(0, chain.length - 1));
    setCurrentRoundIndex(clampedRound);
    setCurrentTaskIndex(clampedTask);
    pausedOffsetMs.current = 0;
    taskStartMs.current = Date.now();
    setRunState("running");
    setHasRang(false);
    autoLatchRef.current = false;
  };

  const onNext = () => {
    chime();
    const lastTaskIdx = chain.length - 1;
    const lastRoundIdx = roundsCount - 1;

    const savedTime = remainingTaskSec;
    if (rollover && savedTime > 0 && currentTaskIndex < lastTaskIdx) {
      nextRolloverRef.current = savedTime;
      setShowRolloverToast(savedTime);
    } else {
      nextRolloverRef.current = 0;
    }

    completeCurrentTask(elapsedSec);

    if (currentTaskIndex < lastTaskIdx) {
      goToTask(currentRoundIndex, currentTaskIndex + 1);
      return;
    }
    if (currentRoundIndex < lastRoundIdx) {
      triggerRoundToast(`Round ${currentRoundIndex + 1} complete!`);
      goToTask(currentRoundIndex + 1, 0);
      return;
    }
    playSessionComplete();
    triggerRoundToast("Session complete! 🎉");
    setRunState("idle");
    setIsSessionComplete(true);
  };

  const onSkip = () => {
    playNav();
    const lastTaskIdx = chain.length - 1;
    const lastRoundIdx = roundsCount - 1;
    markSkipped(currentRoundIndex, currentTaskIndex);
    nextRolloverRef.current = 0;
    if (currentTaskIndex < lastTaskIdx) {
      goToTask(currentRoundIndex, currentTaskIndex + 1);
      return;
    }
    if (currentRoundIndex < lastRoundIdx) {
      triggerRoundToast(`Round ${currentRoundIndex + 1} complete!`);
      goToTask(currentRoundIndex + 1, 0);
      return;
    }
    playSessionComplete();
    triggerRoundToast("Session complete! 🎉");
    setRunState("idle");
    setIsSessionComplete(true);
  };

  const onPrev = () => {
    playNav();
    const lastTaskIdx = chain.length - 1;
    nextRolloverRef.current = 0;
    if (currentTaskIndex > 0) {
      const prevIdx = currentTaskIndex - 1;
      setRounds((prev) => {
        const copy = prev.map((r) => r.map((t) => ({ ...t })));
        copy[currentRoundIndex][prevIdx] = {
          status: "incomplete",
          actualSec: null,
        };
        return copy;
      });
      goToTask(currentRoundIndex, prevIdx);
      return;
    }
    if (currentTaskIndex === 0 && currentRoundIndex > 0) {
      const prevRound = currentRoundIndex - 1;
      setRounds((prev) => {
        const copy = prev.map((r) => r.map((t) => ({ ...t })));
        copy[prevRound][lastTaskIdx] = {
          status: "incomplete",
          actualSec: null,
        };
        return copy;
      });
      goToTask(prevRound, lastTaskIdx);
      return;
    }
    setRounds((prev) => {
      const copy = prev.map((r) => r.map((t) => ({ ...t })));
      copy[currentRoundIndex][currentTaskIndex] = {
        status: "incomplete",
        actualSec: null,
      };
      return copy;
    });
    pausedOffsetMs.current = 0;
    taskStartMs.current = Date.now();
    setRunState("running");
    setHasRang(false);
    autoLatchRef.current = false;
  };

  useEffect(() => {
    if (
      !autocontinue ||
      runState !== "running" ||
      remainingTaskSec !== 0 ||
      autoLatchRef.current
    )
      return;
    autoLatchRef.current = true;
    setRounds((prev) => {
      const copy = prev.map((r) => r.map((t) => ({ ...t })));
      copy[currentRoundIndex][currentTaskIndex] = {
        status: "complete_at",
        actualSec: byId(chain[currentTaskIndex]).targetSec,
      };
      return copy;
    });
    chime();
    nextRolloverRef.current = 0;
    const lastTaskIdx = chain.length - 1;
    const lastRoundIdx = roundsCount - 1;
    if (currentTaskIndex < lastTaskIdx) {
      goToTask(currentRoundIndex, currentTaskIndex + 1);
    } else if (currentRoundIndex < lastRoundIdx) {
      triggerRoundToast(`Round ${currentRoundIndex + 1} complete!`);
      goToTask(currentRoundIndex + 1, 0);
    } else {
      playSessionComplete();
      triggerRoundToast("Session complete! 🎉");
      setRunState("idle");
      setIsSessionComplete(true);
    }
  }, [
    autocontinue,
    remainingTaskSec,
    runState,
    currentTaskIndex,
    currentRoundIndex,
    chain,
    roundsCount,
    byId,
  ]);

  const [activeTab] = useState<"tasks" | "rounds">("tasks");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<EditingValues | null>(
    null
  );
  const [editingMainTimer, setEditingMainTimer] = useState<boolean>(false);
  const [editingMainName, setEditingMainName] = useState<boolean>(false);
  const [tempTime, setTempTime] = useState(fmt(currentTask.targetSec));
  const [tempName, setTempName] = useState(currentTask.name);

  const listContainerRef = useRef<HTMLUListElement | null>(null);
  const taskLightsRef = useRef<HTMLDivElement | null>(null);
  const roundLightsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (lastAddedId && listContainerRef.current) {
      const listEl = listContainerRef.current;
      // Capture page position before
      const pageScrollY = window.scrollY;
      const pageScrollX = window.scrollX;

      // Scroll list instantly (no smooth behavior)
      listEl.scrollTop = listEl.scrollHeight;

      // Force restore page position immediately
      window.scrollTo(pageScrollX, pageScrollY);

      // Double-check after a frame
      requestAnimationFrame(() => {
        window.scrollTo(pageScrollX, pageScrollY);
      });
    }
  }, [lastAddedId]);

  useEffect(() => {
    if (currentTask) {
      setTempTime(fmt(currentTask.targetSec));
      setTempName(currentTask.name);
    }
  }, [currentTask]);

  // Auto-save when scrolling while editing a task
  useEffect(() => {
    const listEl = listContainerRef.current;
    if (!listEl) return;

    const handleScroll = () => {
      if (editingTaskId && editingValues) {
        // Save the current editing values when scroll starts
        handleUpdateTask(
          editingTaskId,
          editingValues.name,
          parseTime(editingValues.timeStr)
        );
        setEditingTaskId(null);
        setEditingValues(null);
        setRunState("idle");
      }
    };

    listEl.addEventListener("scroll", handleScroll);
    return () => listEl.removeEventListener("scroll", handleScroll);
  }, [editingTaskId, editingValues]);

  // Scroll task lights to bottom when there are more than 9 tasks
  useEffect(() => {
    if (taskLightsRef.current && chain.length > 9) {
      taskLightsRef.current.scrollTop = taskLightsRef.current.scrollHeight;
    }
  }, [chain.length]);

  // Scroll round lights to bottom when there are more than 9 rounds
  useEffect(() => {
    if (roundLightsRef.current && roundsCount > 9) {
      roundLightsRef.current.scrollTop = roundLightsRef.current.scrollHeight;
    }
  }, [roundsCount]);

  const handleUpdateTask = (
    taskId: string,
    newName: string,
    newTargetSec: number
  ) => {
    setTasks((prevTasks) =>
      prevTasks.map((t) =>
        t.id === taskId ? { ...t, name: newName, targetSec: newTargetSec } : t
      )
    );
  };

  const handleBlur = (taskId: string | null, e?: React.FocusEvent) => {
    // If focus is moving to another input in the same editing session, don't close yet
    if (
      e?.relatedTarget &&
      (e.relatedTarget as HTMLElement).classList.contains("list-input")
    ) {
      return;
    }

    if (editingMainTimer) {
      const newSec = parseTime(tempTime);
      handleUpdateTask(currentTaskId, currentTask.name, newSec);
      pausedOffsetMs.current = 0;
      taskStartMs.current = null;
      setRunState("idle");
      setEditingMainTimer(false);
      justFinishedEditingRef.current = true;
    }
    if (editingMainName) {
      handleUpdateTask(currentTaskId, tempName, currentTask.targetSec);
      setEditingMainName(false);
      justFinishedEditingRef.current = true;
    }
    if (taskId && editingTaskId === taskId && editingValues) {
      handleUpdateTask(
        taskId,
        editingValues.name,
        parseTime(editingValues.timeStr)
      );
      setEditingTaskId(null);
      setEditingValues(null);
      setRunState("idle");
      justFinishedEditingRef.current = true;
    }
  };

  const startEditing = (task: Task) => {
    setRunState("paused");
    setEditingTaskId(task.id);
    setEditingValues({
      id: task.id,
      name: task.name,
      timeStr: fmt(task.targetSec),
    });
  };

  const restartSession = () => {
    playRestartSound();
    setRounds(
      Array.from({ length: roundsCount }, () =>
        chain.map(() => ({ status: "incomplete", actualSec: null }))
      )
    );
    setCurrentRoundIndex(0);
    setCurrentTaskIndex(0);
    pausedOffsetMs.current = 0;
    taskStartMs.current = null;
    setRunState("idle");
    setIsSessionComplete(false);
    autoLatchRef.current = false;
    nextRolloverRef.current = 0;
    setRolloverOffsetSec(0);
  };

  const handleClearAll = () => {
    const newId = generateId();
    const defaultTask: Task = { id: newId, name: "New Task", targetSec: 60 };
    setTasks([defaultTask]);
    setChain([newId]);
    setRoundsCount(1);
    setRounds([[{ status: "incomplete", actualSec: null }]]);
    setCurrentRoundIndex(0);
    setCurrentTaskIndex(0);
    pausedOffsetMs.current = 0;
    taskStartMs.current = null;
    setRunState("idle");
    setIsSessionComplete(false);
    autoLatchRef.current = false;
    nextRolloverRef.current = 0;
    setRolloverOffsetSec(0);
    setEditingTaskId(null);
    setEditingValues(null);
    setEditingMainTimer(false);
    setEditingMainName(false);
    playDecrease();
    triggerTotalPulse();
    triggerRoundPulse();
  };

  const handleConfirmClearAll = () => {
    handleClearAll();
    setShowConfirmModal(false);
  };

  const handleAddTask = () => {
    // Maximum of 25 tasks
    if (chain.length >= 25) {
      return;
    }
    const newId = generateId();
    const newTask: Task = { id: newId, name: "New Task", targetSec: 60 };
    setTasks((prev) => [...prev, newTask]);
    setChain((prev) => [...prev, newId]);
    startEditing(newTask);
    setLastAddedId(newId);
    triggerRoundPulse();
    playIncrease();
  };

  const handleDeleteTask = (taskId: string, taskIndex: number) => {
    if (chain.length <= 1) return;
    setTasks((prevTasks) => prevTasks.filter((t) => t.id !== taskId));
    setChain((prevChain) => prevChain.filter((id) => id !== taskId));
    if (taskIndex === currentTaskIndex) {
      const newIndex = taskIndex === chain.length - 1 ? 0 : taskIndex;
      setCurrentTaskIndex(newIndex);
    } else if (taskIndex < currentTaskIndex) {
      setCurrentTaskIndex((prevIndex) => prevIndex - 1);
    }
    triggerRoundPulse();
    playDecrease();
  };

  const dragFrom = useRef<number | null>(null);
  const [draggingTaskIndex, setDraggingTaskIndex] = useState<number | null>(
    null
  );

  const moveTask = (from: number, to: number) => {
    if (from === to) return;
    setChain((prev) => {
      const next = [...prev];
      const [id] = next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
    setRounds((prev) =>
      prev.map((row) => {
        const next = [...row];
        const [cell] = next.splice(from, 1);
        next.splice(to, 0, cell);
        return next;
      })
    );
  };
  const onDragStartTask = (i: number) => (e: React.DragEvent) => {
    if (editingTaskId) {
      e.preventDefault();
      return;
    }
    dragFrom.current = i;
    setDraggingTaskIndex(i);
    e.dataTransfer.effectAllowed = "move";

    // Create a more visible drag image
    const target = e.currentTarget as HTMLElement;
    if (target) {
      const rect = target.getBoundingClientRect();
      e.dataTransfer.setDragImage(target, rect.width / 2, rect.height / 2);
    }
  };

  const onDragOverTask = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropTask = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    setDraggingTaskIndex(null);
    if (from == null) return;
    if (runState !== "running" && !editingTaskId) moveTask(from, i);
  };

  const onDragEndTask = () => {
    dragFrom.current = null;
    setDraggingTaskIndex(null);
  };

  // Modal drag-and-drop handlers
  const moveDraftTask = (from: number, to: number) => {
    if (from === to) return;
    setDraftChain((prev) => {
      const next = [...prev];
      const [id] = next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  };

  const onDragStartModalTask = (i: number) => (e: React.DragEvent) => {
    if (editingModalTask) {
      e.preventDefault();
      return;
    }
    modalDragFrom.current = i;
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOverModalTask = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropModalTask = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from = modalDragFrom.current;
    modalDragFrom.current = null;
    if (from == null) return;
    moveDraftTask(from, i);
  };

  const onDragEndModalTask = () => {
    modalDragFrom.current = null;
  };

  // Update draft task name or duration
  const updateDraftTask = (id: string, name: string, targetSec: number) => {
    setDraftById((prev) => ({
      ...prev,
      [id]: { name, targetSec },
    }));
  };

  // Add new task in modal
  const addDraftTask = () => {
    const newId = generateId();
    setDraftChain((prev) => [...prev, newId]);
    setDraftById((prev) => ({
      ...prev,
      [newId]: { name: "New Task", targetSec: 60 },
    }));
    // Auto-edit the new task name
    setTimeout(() => {
      setEditingModalTask({ id: newId, field: "name" });
    }, 50);
  };

  // Calculate round and total time from draft
  const calculateDraftRoundTime = () => {
    return draftChain.reduce((sum, id) => {
      const task = draftById[id];
      return sum + (task?.targetSec || 0);
    }, 0);
  };

  const calculateDraftTotalTime = () => {
    return calculateDraftRoundTime() * draftRoundsCount;
  };

  const changeRounds = (n: number) => {
    const prevCount = roundsCount;
    const finalTotal = Math.min(25, Math.max(1, Math.floor(n) || 1));
    if (finalTotal > prevCount) playIncrease();
    else if (finalTotal < prevCount) playDecrease();
    setRounds((prev) => {
      let next = prev;
      if (finalTotal > prev.length) {
        const add = Array.from({ length: finalTotal - prev.length }, () =>
          chain.map(() => ({ status: "incomplete", actualSec: null }))
        );
        next = [...prev, ...add];
      } else if (finalTotal < prev.length) {
        next = prev.slice(0, finalTotal);
      }
      setCurrentRoundIndex((r) => clamp(r, 0, finalTotal - 1));
      setRoundsCount(finalTotal);
      return next;
    });
    triggerTotalPulse();
  };

  const roundProgress =
    curRoundTarget > 0
      ? ((curRoundTarget - roundRemainingSec) / curRoundTarget) * 100
      : 0;
  const totalProgress =
    fullSessionTarget > 0
      ? ((fullSessionTarget - sessionRemainingSec) / fullSessionTarget) * 100
      : 0;
  const mainProgress =
    effectiveTargetSec > 0
      ? (elapsedMs / (effectiveTargetSec * 1000)) * 100
      : 100;
  const progressPercent = Math.min(100, Math.max(0, mainProgress));

  const tasksTrackFillPct = (() => {
    const n = chain.length;
    if (n <= 1) return 100;
    const completedConnectors = Math.max(0, currentTaskIndex);
    const tgt = currentTask.targetSec || 1;
    const partial = Math.min(1, elapsedSec / tgt);
    const pct = ((completedConnectors + partial) / (n - 1)) * 100;
    return Math.max(0, Math.min(100, pct));
  })();

  const roundsTrackFillPct = (() => {
    const n = roundsCount;
    if (n <= 1) return 100;
    const completedConnectors = Math.max(0, currentRoundIndex);
    const denom = Math.max(1, roundTargetSec(currentRoundIndex));
    const partial = Math.min(1, (roundElapsedActual + elapsedSec) / denom);
    const pct = ((completedConnectors + partial) / (n - 1)) * 100;
    return Math.max(0, Math.min(100, pct));
  })();

  const displayTime = isOvertime ? "0:00" : fmt(remainingTaskSec);
  const overtimeSec = isOvertime ? elapsedSec - effectiveTargetSec : 0;

  return (
    <>
      {/* Loading screen overlay */}
      {isLoading && (
        <div className="loading-screen">
          <div className="loading-content">
            <div className="loading-spinner">
              <div className="pixel-dot"></div>
              <div className="pixel-dot"></div>
              <div className="pixel-dot"></div>
            </div>
            <div className="loading-text">Loading...</div>
          </div>
        </div>
      )}

      {/* Main app - hidden during loading */}
      <div
        className={`window ${focusMode ? "focus-mode" : ""} ${
          isLoading ? "loading" : "loaded"
        }`}
        style={{ visibility: isLoading ? "hidden" : "visible" }}
      >
        <div className="titlebar">
          <div className="appname">
            <img
              src="/weasel-logo-newer-png-small-just-text.png"
              alt="weasel.io"
              className="weasel-text-logo"
            />
            <img
              src="/weasel-logo-newer-png-small-just-weez.png"
              alt="Weasel"
              className={`weasel-character ${weaselJump ? "weasel-jump" : ""}`}
              onClick={() => {
                setWeaselJump(true);
                setTimeout(() => setWeaselJump(false), 600);
                // Play hello sound
                const audio = new Audio("/weasel-hello.mp3");
                audio.volume = 0.5;
                audio.play().catch(() => {
                  /* ignore errors */
                });
              }}
              style={{ cursor: "pointer" }}
            />
          </div>
          <div className="title-buttons">
            <button
              className="settings-btn"
              onClick={() => setShowSettings(true)}
              title="Settings"
            >
              <img
                src="/settings-icon.png"
                alt="Settings"
                className="icon-settings"
              />
            </button>
            <button
              className="settings-btn"
              onClick={() => setShowConfirmModal(true)}
              title="Clear all"
            >
              <img
                src="/trash-icon.png"
                alt="Clear all"
                className="icon-trash"
              />
            </button>
          </div>
          <div className="window-dots" aria-hidden>
            <span className="dot dot-min" />
            <span className="dot dot-max" />
            <span className="dot dot-close" />
          </div>
        </div>

        <div className="overview">
          <div className="ov-left">
            <div
              className={`card timer-card ${pulseRound ? "wiggle-round" : ""}`}
              onAnimationEnd={() => setPulseRound(false)}
            >
              <div
                className="timer-progress-round"
                style={{ transform: `scaleY(${1 - roundProgress / 100})` }}
              />
              <div className="card-content">
                <div className="card-label">Round</div>
                <div className="primary">{fmt(roundRemainingSec)}</div>
                <div className="of">
                  of <span className="time-badge">{fmt(curRoundTarget)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="ov-center">
            <div
              className={`card timer-card ${pulseTotal ? "wiggle-total" : ""}`}
              onAnimationEnd={() => setPulseTotal(false)}
            >
              <div
                className="timer-progress-total"
                style={{ transform: `scaleY(${1 - totalProgress / 100})` }}
              />
              <div className="card-content">
                <div className="card-label">Total</div>
                <div className="primary">{fmt(sessionRemainingSec)}</div>
                <div className="of">
                  of{" "}
                  <span className="time-badge">{fmt(fullSessionTarget)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="ov-right">
            <div className="card stepper-card">
              <div className="stepper-top">
                <div className="stepper-col">
                  <div className="stepper-title">Tasks</div>
                  <div className="lights-row" aria-label="Task progress">
                    <PieChart
                      segments={chain.length}
                      currentIndex={currentTaskIndex}
                      size={62}
                      getSegmentColor={taskLightColor}
                      segmentValues={chain.map((id) => byId(id).targetSec)}
                    />
                  </div>
                </div>

                <div className="stepper-divider" />

                <div className="stepper-col">
                  <div className="stepper-title">Rounds</div>
                  <div className="lights-row" aria-label="Round progress">
                    <PieChart
                      segments={roundsCount}
                      currentIndex={currentRoundIndex}
                      size={62}
                      getSegmentColor={roundLightColor}
                    />
                  </div>
                </div>
              </div>

              <div className="stepper-bottom">
                <span className="stepper-bottom-label">Total Rounds</span>
                <div className="stepper-bottom-controls">
                  <button
                    className="btn stepper-btn"
                    onClick={() => changeRounds(roundsCount - 1)}
                    aria-label="Decrease total rounds"
                  >
                    −
                  </button>
                  <input
                    className="stepper-input"
                    type="text"
                    value={roundsCount}
                    onChange={(e) => {
                      // Allow temporary empty or partial values while typing
                      const value = e.target.value;
                      if (value === "") {
                        setRoundsCount("" as any);
                        return;
                      }
                      const v = parseInt(value, 10);
                      if (!Number.isNaN(v) && v >= 0) {
                        setRoundsCount(v);
                      }
                    }}
                    onBlur={(e) => {
                      let v = parseInt(e.target.value, 10);
                      if (Number.isNaN(v) || v < 1) v = 1;
                      changeRounds(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        let v = parseInt(e.currentTarget.value, 10);
                        if (Number.isNaN(v) || v < 1) v = 1;
                        changeRounds(v);
                        e.currentTarget.blur();
                      }
                    }}
                    aria-label="Total rounds value"
                  />
                  <button
                    className="btn stepper-btn"
                    onClick={() => changeRounds(roundsCount + 1)}
                    aria-label="Increase total rounds"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="content">
          <div className="left">
            <div
              className="timer-area"
              ref={timerAreaRef}
              onClick={!isSessionComplete ? handleTimerAreaClick : undefined}
              data-focusable={!isSessionComplete}
            >
              {isOvertime && !isSessionComplete && (
                <div className="overtime-counter">+{fmt(overtimeSec)}</div>
              )}
              {isSessionComplete ? (
                <div className="all-done-view">
                  <h2>All done!</h2>
                  <div className="all-done-controls">
                    <button
                      className="btn btn-placeholder"
                      onClick={() => {
                        setEditingSequenceId(null);
                        setShowSaveModal(true);
                      }}
                    >
                      Save as template
                    </button>
                    <button className="btn btn-repeat" onClick={restartSession}>
                      Repeat
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className={`round-toast ${showRoundToast ? "show" : ""}`}
                    onAnimationEnd={() => setShowRoundToast(false)}
                    role="status"
                    aria-live="polite"
                  >
                    <span className="round-toast-icon" aria-hidden>
                      🎉
                    </span>
                    <span>{roundToastText}</span>
                  </div>
                  {showRolloverToast && (
                    <div
                      className="rollover-toast show"
                      onAnimationEnd={() => setShowRolloverToast(null)}
                    >
                      +{fmt(showRolloverToast)}
                    </div>
                  )}
                  <button
                    className="side-arrow prev"
                    onClick={onPrev}
                    title="Previous task"
                  >
                    ‹
                  </button>
                  <div className="timer-content">
                    <div className="timer-box">
                      {editingMainTimer ? (
                        <input
                          className="main-timer-input"
                          value={tempTime}
                          onChange={(e) => setTempTime(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleBlur(null);
                          }}
                          onBlur={() => handleBlur(null)}
                          autoFocus
                        />
                      ) : (
                        <div
                          className="bigtime"
                          data-nocapture="true"
                          onClick={() => setEditingMainTimer(true)}
                          aria-live="polite"
                        >
                          {displayTime}
                        </div>
                      )}
                      {editingMainName ? (
                        <input
                          className="main-name-input"
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleBlur(null);
                          }}
                          onBlur={() => handleBlur(null)}
                          autoFocus
                        />
                      ) : (
                        <div
                          className="taskname"
                          data-nocapture="true"
                          onClick={() => setEditingMainName(true)}
                        >
                          {currentTask.name}
                        </div>
                      )}
                      <div className="controls">
                        <button
                          className="btn btn-neutral btn-restart"
                          onClick={restartCurrent}
                          title="Restart"
                        >
                          <img
                            src="/repeat-icon.svg"
                            alt="Restart"
                            className="btn-icon-img"
                          />
                        </button>
                        <button
                          className="btn btn-neutral btn-pause"
                          onClick={pauseAll}
                          title="Pause"
                          style={{
                            display:
                              runState === "running" ? "inline-flex" : "none",
                          }}
                        >
                          <img
                            src="/pause-icon.svg"
                            alt="Pause"
                            className="btn-icon-img"
                          />
                        </button>
                        <button
                          className="btn btn-neutral"
                          onClick={startOrResume}
                          title="Play"
                          style={{
                            display:
                              runState === "running" ? "none" : "inline-flex",
                          }}
                        >
                          <img
                            src="/play-icon.svg"
                            alt="Play"
                            className="btn-icon-img"
                          />
                        </button>

                        <button
                          className="btn btn-confirm"
                          onClick={onNext}
                          title="Done"
                        >
                          <img
                            src="/done-icon.svg"
                            alt="Done"
                            className="btn-icon-img"
                          />
                        </button>
                      </div>
                      <div className="next-task">
                        Next:{" "}
                        {
                          byId(chain[(currentTaskIndex + 1) % chain.length])
                            .name
                        }{" "}
                        <span style={{ position: "relative", top: "2px" }}>
                          •
                        </span>{" "}
                        {fmt(
                          byId(chain[(currentTaskIndex + 1) % chain.length])
                            .targetSec
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    className="side-arrow next"
                    onClick={rightArrowAction === "skip" ? onSkip : onNext}
                    title={rightArrowAction === "skip" ? "Skip task" : "Done"}
                  >
                    ›
                  </button>
                </>
              )}
            </div>
          </div>

          <aside className="right">
            <div className="planner-panel">
              {activeTab === "tasks" && (
                <div className="sheet-section">
                  <div
                    className="task-toolbar"
                    role="group"
                    aria-label="Task tools"
                  >
                    <button
                      className="btn btn-neutral add-btn"
                      onClick={handleAddTask}
                    >
                      <span className="btn-icon" aria-hidden>
                        +
                      </span>
                      <span>Add New</span>
                    </button>
                  </div>
                  <ul className="list" ref={listContainerRef}>
                    {chain.map((id, i) => {
                      const t = byId(id);
                      const color = taskLightColor(i);
                      const isActive = i === currentTaskIndex;
                      const isEditing = editingTaskId === t.id;
                      const isJustAdded = lastAddedId === id;
                      const skipped = isSkipped(currentRoundIndex, i);
                      return (
                        <li
                          key={id}
                          ref={
                            isEditing
                              ? (el) =>
                                  el &&
                                  el.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center",
                                  })
                              : null
                          }
                          className={`list-row draggable ${
                            isActive ? "is-current" : ""
                          } ${isJustAdded ? "highlight-new" : ""} ${
                            draggingTaskIndex === i ? "dragging" : ""
                          }`}
                          onAnimationEnd={(e: any) => {
                            if (
                              isJustAdded &&
                              (e.animationName === "rowGlow" ||
                                e.animationName === "rowWiggle")
                            ) {
                              setLastAddedId(null);
                            }
                          }}
                          onBlur={(e) => {
                            if (
                              !e.currentTarget.contains(e.relatedTarget as Node)
                            ) {
                              handleBlur(t.id);
                            }
                          }}
                          draggable={!isEditing}
                          onDragStart={onDragStartTask(i)}
                          onDragOver={onDragOverTask(i)}
                          onDrop={onDropTask(i)}
                          onDragEnd={onDragEndTask}
                          title={skipped ? "Skipped" : "Drag to reorder"}
                        >
                          <span
                            className={`current-indicator ${
                              isActive ? "visible" : ""
                            }`}
                          >
                            ›
                          </span>
                          <span
                            className={`mini-dot mdot-${color} ${
                              skipped ? "skipped" : ""
                            }`}
                          />
                          {isEditing && editingValues ? (
                            <>
                              <input
                                className="list-input edit-name"
                                type="text"
                                value={editingValues.name}
                                onChange={(e) =>
                                  setEditingValues({
                                    ...editingValues,
                                    name: e.target.value,
                                  })
                                }
                                onBlur={(e) => handleBlur(t.id, e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleBlur(t.id);
                                }}
                                autoFocus
                              />
                              <input
                                className="list-input edit-time"
                                type="text"
                                value={editingValues.timeStr}
                                onChange={(e) =>
                                  setEditingValues({
                                    ...editingValues,
                                    timeStr: e.target.value,
                                  })
                                }
                                onBlur={(e) => handleBlur(t.id, e)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleBlur(t.id);
                                }}
                              />
                            </>
                          ) : (
                            <>
                              <span
                                className="list-name"
                                onClick={() => startEditing(t)}
                              >
                                {t.name}
                              </span>
                              <span
                                className="list-time"
                                onClick={() => startEditing(t)}
                              >
                                {fmt(t.targetSec)}
                              </span>
                            </>
                          )}
                          <span className="drag-handle" aria-hidden>
                            ⋮⋮
                          </span>
                          <button
                            className="delete-btn"
                            onClick={() => handleDeleteTask(t.id, i)}
                            title="Delete Task"
                          >
                            +
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>

        {showSettings && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSettings(false);
            }}
          >
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div id="settings-title" className="modal-title">
                  Settings
                </div>
                <button
                  className="modal-close"
                  onClick={() => setShowSettings(false)}
                >
                  Close
                </button>
              </div>

              <div className="setting-row">
                <input
                  id="autocontinue"
                  type="checkbox"
                  checked={autocontinue}
                  onChange={(e) => setAutocontinue(e.target.checked)}
                />
                <label htmlFor="autocontinue">Autocontinue</label>
              </div>
              <div className="setting-help">
                When enabled, tasks automatically advance when their time runs
                out.
              </div>

              <div className="setting-row">
                <input
                  id="rollover"
                  type="checkbox"
                  checked={rollover}
                  onChange={(e) => setRollover(e.target.checked)}
                />
                <label htmlFor="rollover">Rollover</label>
              </div>
              <div className="setting-help">
                Add remaining time from one task to the next within the same
                round.
              </div>

              <div className="setting-row">
                <label style={{ fontWeight: 600 }}>
                  Right arrow (›) action:
                </label>
              </div>
              <div className="setting-row" style={{ paddingLeft: "20px" }}>
                <input
                  id="arrow-skip"
                  type="radio"
                  name="rightArrowAction"
                  checked={rightArrowAction === "skip"}
                  onChange={() => setRightArrowAction("skip")}
                />
                <label htmlFor="arrow-skip">Skip task</label>
              </div>
              <div className="setting-row" style={{ paddingLeft: "20px" }}>
                <input
                  id="arrow-done"
                  type="radio"
                  name="rightArrowAction"
                  checked={rightArrowAction === "done"}
                  onChange={() => setRightArrowAction("done")}
                />
                <label htmlFor="arrow-done">Mark as done</label>
              </div>
              <div className="setting-help">
                Choose whether the right arrow skips the task or marks it
                complete.
              </div>

              <div className="modal-footer">
                <button
                  className="btn-save"
                  onClick={() => setShowSettings(false)}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {showSaveModal && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSaveModal(false);
            }}
          >
            <div
              className="modal modal-large"
              role="dialog"
              aria-modal="true"
              aria-labelledby="save-sequence-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div id="save-sequence-title" className="modal-title">
                  {editingSequenceId ? "Edit Session" : "Save Session"}
                </div>
                <button
                  className="modal-close"
                  onClick={() => {
                    setShowSaveModal(false);
                    setEditingSequenceId(null);
                  }}
                >
                  Close
                </button>
              </div>

              <div className="modal-body">
                <div className="sequence-name-input">
                  <label htmlFor="sequence-name">Session Name</label>
                  <input
                    id="sequence-name"
                    type="text"
                    value={sequenceName}
                    onChange={(e) => setSequenceName(e.target.value)}
                    placeholder="Enter session name..."
                  />
                </div>

                <div className="sequence-tasks-section">
                  <div className="sequence-tasks-label">Tasks in Sequence</div>
                  <ul className="sequence-task-list">
                    {draftChain.map((id, i) => {
                      const t = draftById[id];
                      if (!t) return null;
                      const isEditingName =
                        editingModalTask?.id === id &&
                        editingModalTask?.field === "name";
                      const isEditingTime =
                        editingModalTask?.id === id &&
                        editingModalTask?.field === "time";

                      return (
                        <li
                          key={id}
                          className="sequence-task-row"
                          draggable={!editingModalTask}
                          onDragStart={onDragStartModalTask(i)}
                          onDragOver={onDragOverModalTask(i)}
                          onDrop={onDropModalTask(i)}
                          onDragEnd={onDragEndModalTask}
                        >
                          <span className="drag-handle" aria-hidden>
                            ⋮⋮
                          </span>

                          {isEditingName ? (
                            <input
                              className="task-name-edit"
                              type="text"
                              value={t.name}
                              autoFocus
                              onChange={(e) =>
                                updateDraftTask(id, e.target.value, t.targetSec)
                              }
                              onBlur={() => setEditingModalTask(null)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") {
                                  setEditingModalTask(null);
                                }
                              }}
                            />
                          ) : (
                            <span
                              className="task-name-display"
                              onClick={() =>
                                setEditingModalTask({ id, field: "name" })
                              }
                            >
                              {t.name}
                            </span>
                          )}

                          {isEditingTime ? (
                            <input
                              className="task-time-edit"
                              type="text"
                              value={fmt(t.targetSec)}
                              autoFocus
                              onChange={(e) => {
                                const newSec = parseTime(e.target.value);
                                updateDraftTask(id, t.name, newSec);
                              }}
                              onBlur={() => setEditingModalTask(null)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") {
                                  setEditingModalTask(null);
                                }
                              }}
                            />
                          ) : (
                            <span
                              className="task-time-display"
                              onClick={() =>
                                setEditingModalTask({ id, field: "time" })
                              }
                            >
                              {fmt(t.targetSec)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="modal-task-actions">
                    <button
                      className="add-task-modal-btn"
                      onClick={addDraftTask}
                    >
                      <span className="btn-icon">+</span>
                      add task
                    </button>
                    <div className="modal-rounds-control">
                      <span className="modal-rounds-label">Rounds:</span>
                      <button
                        className="modal-stepper-btn"
                        onClick={() =>
                          setDraftRoundsCount(Math.max(1, draftRoundsCount - 1))
                        }
                        disabled={draftRoundsCount <= 1}
                      >
                        −
                      </button>
                      <span className="modal-rounds-value">
                        {draftRoundsCount}
                      </span>
                      <button
                        className="modal-stepper-btn"
                        onClick={() =>
                          setDraftRoundsCount(
                            Math.min(99, draftRoundsCount + 1)
                          )
                        }
                        disabled={draftRoundsCount >= 99}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <div className="sequence-time-summary">
                  <span className="time-summary-label">
                    Round time:{" "}
                    <strong>{fmt(calculateDraftRoundTime())}</strong>
                  </span>
                  <span className="time-summary-separator">|</span>
                  <span className="time-summary-label">
                    Total time:{" "}
                    <strong>{fmt(calculateDraftTotalTime())}</strong>
                  </span>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  className="btn btn-cancel"
                  onClick={() => {
                    setShowSaveModal(false);
                    setSequenceName("");
                    setEditingSequenceId(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-save"
                  onClick={() => {
                    if (!sequenceName.trim()) {
                      alert("Please enter a session name");
                      return;
                    }

                    // 1. Create any new tasks that don't exist yet
                    const existingTaskIds = new Set(tasks.map((t) => t.id));
                    const newTasks: Task[] = [];
                    draftChain.forEach((id) => {
                      if (!existingTaskIds.has(id) && draftById[id]) {
                        newTasks.push({
                          id,
                          name: draftById[id].name,
                          targetSec: draftById[id].targetSec,
                        });
                      }
                    });
                    if (newTasks.length > 0) {
                      setTasks((prev) => [...prev, ...newTasks]);
                    }

                    // 2. Update the chain
                    setChain(draftChain);

                    // 3. Sync rounds array to match new chain length
                    setRounds((prev) => {
                      const newChainLength = draftChain.length;
                      return prev.map((round) => {
                        if (round.length === newChainLength) return round;
                        if (round.length < newChainLength) {
                          // Add new incomplete results for new tasks
                          const toAdd = newChainLength - round.length;
                          return [
                            ...round,
                            ...Array(toAdd).fill({
                              status: "incomplete",
                              actualSec: null,
                            }),
                          ];
                        } else {
                          // Remove results if chain got shorter (shouldn't happen with add, but for safety)
                          return round.slice(0, newChainLength);
                        }
                      });
                    });

                    // 4. Update existing tasks that changed
                    draftChain.forEach((id) => {
                      const d = draftById[id];
                      if (!d) return;
                      const orig = tasks.find((t) => t.id === id);
                      if (
                        orig &&
                        (orig.name !== d.name || orig.targetSec !== d.targetSec)
                      ) {
                        handleUpdateTask(id, d.name, d.targetSec);
                      }
                    });

                    // 5. Apply rounds count change
                    if (draftRoundsCount !== roundsCount) {
                      changeRounds(draftRoundsCount);
                    }

                    // 6. Save or update sequence in localStorage
                    if (editingSequenceId) {
                      // Update existing sequence
                      const updatedSequences = savedSequences.map((seq) =>
                        seq.id === editingSequenceId
                          ? {
                              ...seq,
                              name: sequenceName.trim(),
                              tasks: draftChain.map((id) => {
                                const d = draftById[id];
                                return {
                                  id,
                                  name: d.name,
                                  targetSec: d.targetSec,
                                };
                              }),
                              chain: draftChain,
                              roundsCount: draftRoundsCount,
                              savedAt: Date.now(),
                            }
                          : seq
                      );
                      saveSequencesToStorage(updatedSequences);
                    } else {
                      // Create new sequence
                      const newSequence: SavedSequence = {
                        id: `seq-${Date.now()}`,
                        name: sequenceName.trim(),
                        tasks: draftChain.map((id) => {
                          const d = draftById[id];
                          return { id, name: d.name, targetSec: d.targetSec };
                        }),
                        chain: draftChain,
                        roundsCount: draftRoundsCount,
                        savedAt: Date.now(),
                      };
                      const updatedSequences = [...savedSequences, newSequence];
                      saveSequencesToStorage(updatedSequences);
                    }

                    // 7. Show saved alert
                    setShowSavedAlert(true);
                    setTimeout(() => setShowSavedAlert(false), 2000);

                    setShowSaveModal(false);
                    setSequenceName("");
                    setEditingSequenceId(null);
                  }}
                >
                  Save and Load
                </button>
              </div>
            </div>
          </div>
        )}

        {showLoadModal && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowLoadModal(false);
            }}
          >
            <div
              className="modal modal-large"
              role="dialog"
              aria-modal="true"
              aria-labelledby="load-sequence-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div id="load-sequence-title" className="modal-title">
                  Load Session
                </div>
                <button
                  className="modal-close"
                  onClick={() => setShowLoadModal(false)}
                >
                  Close
                </button>
              </div>

              <div className="modal-body">
                {savedSequences.length === 0 ? (
                  <div className="empty-sequences">
                    <p>No saved sessions yet.</p>
                    <p>Save your current session to see it here!</p>
                  </div>
                ) : (
                  <ul className="saved-sequences-list">
                    {savedSequences
                      .sort((a, b) => b.savedAt - a.savedAt)
                      .map((seq) => {
                        const totalTime =
                          seq.tasks.reduce((sum, t) => sum + t.targetSec, 0) *
                          seq.roundsCount;
                        return (
                          <li
                            key={seq.id}
                            className="saved-sequence-item"
                            onClick={() => {
                              // Load the sequence
                              const existingTaskIds = new Set(
                                tasks.map((t) => t.id)
                              );
                              const newTasks: Task[] = [];
                              seq.tasks.forEach((task) => {
                                if (!existingTaskIds.has(task.id)) {
                                  newTasks.push(task);
                                }
                              });

                              if (newTasks.length > 0) {
                                setTasks((prev) => [...prev, ...newTasks]);
                              }

                              // Update existing tasks
                              seq.tasks.forEach((task) => {
                                const existing = tasks.find(
                                  (t) => t.id === task.id
                                );
                                if (
                                  existing &&
                                  (existing.name !== task.name ||
                                    existing.targetSec !== task.targetSec)
                                ) {
                                  handleUpdateTask(
                                    task.id,
                                    task.name,
                                    task.targetSec
                                  );
                                }
                              });

                              setChain(seq.chain);
                              changeRounds(seq.roundsCount);

                              // Reset the session
                              restartSession();

                              setShowLoadModal(false);
                              playNav();
                            }}
                          >
                            <div className="sequence-item-header">
                              <span className="sequence-name">{seq.name}</span>
                              <div className="sequence-item-actions">
                                <button
                                  className="edit-sequence-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Pre-populate the edit modal with this sequence's data
                                    setEditingSequenceId(seq.id);
                                    setSequenceName(seq.name);

                                    // Set up draft data
                                    const draftMap: Record<
                                      string,
                                      { name: string; targetSec: number }
                                    > = {};
                                    seq.tasks.forEach((task) => {
                                      draftMap[task.id] = {
                                        name: task.name,
                                        targetSec: task.targetSec,
                                      };
                                    });
                                    setDraftById(draftMap);
                                    setDraftChain(seq.chain);
                                    setDraftRoundsCount(seq.roundsCount);

                                    // Close load modal and open save modal
                                    setShowLoadModal(false);
                                    setShowSaveModal(true);
                                  }}
                                  title="Edit session"
                                >
                                  ✎
                                </button>
                                <button
                                  className="delete-sequence-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (
                                      window.confirm(
                                        `Delete "${seq.name}"? This cannot be undone.`
                                      )
                                    ) {
                                      const updated = savedSequences.filter(
                                        (s) => s.id !== seq.id
                                      );
                                      saveSequencesToStorage(updated);
                                    }
                                  }}
                                  title="Delete session"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            <div className="sequence-item-details">
                              <span>
                                {seq.tasks.length} task
                                {seq.tasks.length !== 1 ? "s" : ""}
                              </span>
                              <span>•</span>
                              <span>
                                {seq.roundsCount} round
                                {seq.roundsCount !== 1 ? "s" : ""}
                              </span>
                              <span>•</span>
                              <span>{fmt(totalTime)} total</span>
                            </div>
                            <div className="sequence-item-date">
                              Saved {new Date(seq.savedAt).toLocaleDateString()}
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {showConfirmModal && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowConfirmModal(false);
            }}
          >
            <div
              className="modal confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-clear-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2 id="confirm-clear-title" className="modal-title">
                  Clear Session?
                </h2>
              </div>
              <div className="modal-body">
                <p className="modal-message">
                  This will remove all tasks and reset your session.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  className="btn-cancel"
                  onClick={() => setShowConfirmModal(false)}
                >
                  Back
                </button>
                <button
                  className="btn-confirm-delete"
                  onClick={handleConfirmClearAll}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {!focusMode && (
          <div className="saveload-bar">
            <div className="saveload-content">
              <div className="saveload-pills">
                <button
                  className="saveload-pill"
                  onClick={() => {
                    setEditingSequenceId(null);
                    setShowSaveModal(true);
                  }}
                >
                  save session
                </button>
                <button
                  className="saveload-pill"
                  onClick={() => setShowLoadModal(true)}
                >
                  load session
                </button>
              </div>
              <div className="saveload-icon">
                {/* Pixel art sequence icon - 3 stacked boxes */}
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect x="6" y="4" width="12" height="4" fill="#9CA3AF" />
                  <rect x="6" y="10" width="12" height="4" fill="#9CA3AF" />
                  <rect x="6" y="16" width="12" height="4" fill="#9CA3AF" />
                  <rect x="7" y="5" width="10" height="2" fill="#D1D5DB" />
                </svg>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Saved alert - outside window container to avoid overflow clipping */}
      {showSavedAlert && (
        <div className="saved-alert">
          <span className="saved-icon">✓</span>
          Session saved!
        </div>
      )}
    </>
  );
}

