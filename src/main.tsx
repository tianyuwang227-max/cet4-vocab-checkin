import React from "react";
import ReactDOM from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, CalendarCheck, Check, ClipboardList, Headphones, ListChecks, Play, RotateCcw, Upload, X } from "lucide-react";
import "./styles.css";

type User = { id: string; name: string };
type Group = { id: number; group_number: number; title: string; word_count: number };
type Checkin = { study_done: number; review_done: number; wrong_review_done: number; completed_at: string | null };
type Word = { id: number; word: string; meaning: string; group_id: number; position: number; wrong_count?: number; options?: string[] };
type Session = { id: string; mode: string; kind: string; current_index: number; total: number; correct_count: number; wrong_count: number; status: string };
type AppState = {
  users: User[];
  currentUserId: string;
  date: string;
  todayGroup: Group | null;
  todayGroupNumber: number;
  groups: Group[];
  checkin: Checkin;
  activeSessions: Session[];
  makeupGroups: Group[];
  wrongWords: Word[];
  reviewCount: number;
  modes: Record<string, string>;
};

type View = "home" | "import" | "groups" | "learn" | "review" | "checkins";
type PracticeKind = "today" | "makeup" | "review" | "wrong";

const modes = [
  { id: "listen_spell", label: "听音拼写", icon: Headphones },
  { id: "meaning_choice", label: "看意选择", icon: ListChecks },
  { id: "meaning_listen_spell", label: "意音拼写", icon: BookOpen },
  { id: "random_spell", label: "乱序拼写", icon: RotateCcw },
];

const today = new Date().toLocaleDateString("en-CA");

function App() {
  const [userId, setUserId] = React.useState(localStorage.getItem("cet4-user") || "wang");
  const [state, setState] = React.useState<AppState | null>(null);
  const [view, setView] = React.useState<View>("home");
  const [practice, setPractice] = React.useState<{ session: Session; words: Word[]; index: number; answer: string; last?: { ok: boolean; correctWord: string } } | null>(null);
  const [selectedMode, setSelectedMode] = React.useState("listen_spell");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async (nextUser = userId) => {
    const data = await api<AppState>(`/api/app?userId=${nextUser}&date=${today}`);
    setState(data);
  }, [userId]);

  React.useEffect(() => {
    localStorage.setItem("cet4-user", userId);
    load(userId).catch(console.error);
  }, [userId, load]);

  const currentUser = state?.users.find((user) => user.id === userId);

  async function start(kind: PracticeKind, groupId?: number, mode = selectedMode) {
    setBusy(true);
    try {
      const data = await api<{ session: Session; words: Word[] }>("/api/sessions/start", {
        method: "POST",
        body: { userId, mode, kind, groupId, date: today },
      });
      setPractice({ ...data, index: 0, answer: "" });
      setView("learn");
      speakIfNeeded(data.words[0], mode);
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer() {
    if (!practice) return;
    const word = practice.words[practice.index];
    const value = selectedMode === "meaning_choice" ? practice.answer : practice.answer.trim();
    if (!value) return;
    const result = await api<{ isCorrect: boolean; correctWord: string; session: Session }>("/api/sessions/answer", {
      method: "POST",
      body: { sessionId: practice.session.id, userId, wordId: word.id, answer: value },
    });
    setPractice((current) => current && { ...current, session: result.session, last: { ok: result.isCorrect, correctWord: result.correctWord } });
  }

  async function nextQuestion() {
    if (!practice) return;
    const next = practice.index + 1;
    if (next >= practice.words.length) {
      const result = await api<{ wrongWords: Word[]; app: AppState; session: Session }>("/api/sessions/finish", {
        method: "POST",
        body: { sessionId: practice.session.id, userId, date: today },
      });
      setState(result.app);
      setPractice((current) => current && { ...current, session: result.session, index: next, answer: "", last: undefined });
      return;
    }
    setPractice((current) => current && { ...current, index: next, answer: "", last: undefined });
    speakIfNeeded(practice.words[next], selectedMode);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C4</div>
          <div>
            <strong>四级打卡</strong>
            <span>{today}</span>
          </div>
        </div>
        <div className="user-switch">
          {state?.users.map((user) => (
            <button className={user.id === userId ? "active" : ""} key={user.id} onClick={() => setUserId(user.id)}>
              {user.name}
            </button>
          ))}
        </div>
        <nav>
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}><ClipboardList />今日</button>
          <button className={view === "import" ? "active" : ""} onClick={() => setView("import")}><Upload />录入</button>
          <button className={view === "groups" ? "active" : ""} onClick={() => setView("groups")}><BookOpen />词组</button>
          <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}><RotateCcw />复习</button>
          <button className={view === "checkins" ? "active" : ""} onClick={() => setView("checkins")}><CalendarCheck />打卡</button>
        </nav>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">{currentUser?.name || "学习者"}</span>
            <h1>{viewTitle(view)}</h1>
          </div>
          <CheckinStrip checkin={state?.checkin} />
        </header>

        <AnimatePresence mode="wait">
          <motion.section key={practice ? "practice" : view} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            {practice ? (
              <PracticePanel
                practice={practice}
                mode={selectedMode}
                onAnswer={(answer) => setPractice((current) => current && { ...current, answer })}
                onSubmit={submitAnswer}
                onNext={nextQuestion}
                onExit={() => {
                  setPractice(null);
                  load().catch(console.error);
                }}
              />
            ) : (
              <>
                {view === "home" && state && <Home state={state} selectedMode={selectedMode} setSelectedMode={setSelectedMode} start={start} busy={busy} />}
                {view === "import" && <ImportWords onImported={() => load().catch(console.error)} />}
                {view === "groups" && state && <Groups groups={state.groups} />}
                {view === "review" && state && <Review state={state} selectedMode={selectedMode} setSelectedMode={setSelectedMode} start={start} />}
                {view === "checkins" && <Checkins checkin={state?.checkin} userName={currentUser?.name || ""} />}
              </>
            )}
          </motion.section>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Home({ state, selectedMode, setSelectedMode, start, busy }: { state: AppState; selectedMode: string; setSelectedMode: (mode: string) => void; start: (kind: PracticeKind, groupId?: number, mode?: string) => void; busy: boolean }) {
  return (
    <div className="stack">
      <section className="task-band">
        <div>
          <span className="eyebrow">今日新词</span>
          <h2>{state.todayGroup ? `${state.todayGroup.title} · ${state.todayGroup.word_count}/30` : "还没有单词组"}</h2>
          <p>两个人每天学习同一组词，答题、错词和打卡分别记录。</p>
        </div>
        <button className="primary" disabled={!state.todayGroup || busy} onClick={() => state.todayGroup && start("today", state.todayGroup.id)}>
          <Play />开始
        </button>
      </section>
      <ModePicker value={selectedMode} onChange={setSelectedMode} />
      <div className="grid two">
        <Panel title="补学">
          {state.makeupGroups.length === 0 ? <Empty text="没有待补学的旧任务" /> : state.makeupGroups.map((group) => (
            <Row key={group.id} title={group.title} meta={`${group.word_count} 个词`} action="补学" onClick={() => start("makeup", group.id)} />
          ))}
        </Panel>
        <Panel title="错词">
          {state.wrongWords.length === 0 ? <Empty text="暂时没有高频错词" /> : state.wrongWords.map((word) => (
            <div className="word-row" key={word.id}><strong>{word.word}</strong><span>{word.meaning}</span><em>{word.wrong_count} 次</em></div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function ModePicker({ value, onChange }: { value: string; onChange: (mode: string) => void }) {
  return (
    <div className="mode-grid">
      {modes.map((mode) => {
        const Icon = mode.icon;
        return (
          <button key={mode.id} className={value === mode.id ? "mode active" : "mode"} onClick={() => onChange(mode.id)}>
            <Icon />
            <span>{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PracticePanel({ practice, mode, onAnswer, onSubmit, onNext, onExit }: { practice: NonNullable<ReturnType<typeof usePracticeType>>; mode: string; onAnswer: (answer: string) => void; onSubmit: () => void; onNext: () => void; onExit: () => void }) {
  const finished = practice.index >= practice.words.length;
  const word = practice.words[practice.index];
  const progress = Math.min(100, (practice.index / practice.words.length) * 100);

  if (finished) {
    return (
      <div className="result">
        <h2>这一轮完成了</h2>
        <div className="score-grid">
          <strong>{practice.session.correct_count}</strong>
          <strong>{practice.session.wrong_count}</strong>
          <span>正确</span>
          <span>错误</span>
        </div>
        <button className="primary" onClick={onExit}><Check />回到首页</button>
      </div>
    );
  }

  return (
    <div className="practice">
      <div className="practice-head">
        <button className="ghost" onClick={onExit}>暂停</button>
        <span>{practice.index + 1} / {practice.words.length}</span>
      </div>
      <div className="progress"><span style={{ width: `${progress}%` }} /></div>
      <div className="question">
        <span className="eyebrow">{modeLabel(mode)}</span>
        <h2>{mode === "listen_spell" ? "听发音，写出单词" : word.meaning}</h2>
        {mode !== "meaning_choice" && <button className="sound" onClick={() => speak(word.word)}><Headphones />播放</button>}
      </div>
      {mode === "meaning_choice" ? (
        <div className="choice-grid">
          {(word.options || [word.word]).map((option) => (
            <button key={option} className={practice.answer === option ? "choice active" : "choice"} onClick={() => onAnswer(option)}>{option}</button>
          ))}
        </div>
      ) : (
        <input className="answer-input" autoFocus value={practice.answer} onChange={(event) => onAnswer(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !practice.last && onSubmit()} placeholder="输入英文单词" />
      )}
      {practice.last && (
        <motion.div className={practice.last.ok ? "feedback ok" : "feedback bad"} initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          {practice.last.ok ? <Check /> : <X />}
          <span>{practice.last.ok ? "正确" : `正确答案：${practice.last.correctWord}`}</span>
        </motion.div>
      )}
      <div className="actions">
        {!practice.last ? <button className="primary" onClick={onSubmit}>提交</button> : <button className="primary" onClick={onNext}>下一题</button>}
      </div>
    </div>
  );
}

function ImportWords({ onImported }: { onImported: () => void }) {
  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<string>("");
  const preview = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8);

  async function submit() {
    const data = await api<{ insertedCount: number; skipped: string[] }>("/api/words/import", { method: "POST", body: { text } });
    setResult(`已导入 ${data.insertedCount} 个，跳过重复 ${data.skipped.length} 个`);
    setText("");
    onImported();
  }

  return (
    <div className="grid two">
      <Panel title="批量录入">
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={"abandon 放弃；抛弃\nability 能力；才能"} />
        <button className="primary" disabled={!text.trim()} onClick={submit}><Upload />导入</button>
        {result && <p className="notice">{result}</p>}
      </Panel>
      <Panel title="解析预览">
        {preview.length === 0 ? <Empty text="粘贴后一行一个单词" /> : preview.map((line, index) => <div className="preview-line" key={`${line}-${index}`}>{line}</div>)}
      </Panel>
    </div>
  );
}

function Groups({ groups }: { groups: Group[] }) {
  return (
    <Panel title="单词组">
      {groups.length === 0 ? <Empty text="还没有录入单词" /> : groups.map((group) => (
        <div className="group-row" key={group.id}>
          <strong>{group.title}</strong>
          <span>{group.word_count}/30</span>
        </div>
      ))}
    </Panel>
  );
}

function Review({ state, selectedMode, setSelectedMode, start }: { state: AppState; selectedMode: string; setSelectedMode: (mode: string) => void; start: (kind: PracticeKind, groupId?: number, mode?: string) => void }) {
  return (
    <div className="stack">
      <ModePicker value={selectedMode} onChange={setSelectedMode} />
      <div className="grid two">
        <Panel title="今日复习">
          <p className="muted">昨日词、最近错词和高频错词去重后最多 30 个。</p>
          <button className="primary" disabled={state.reviewCount === 0} onClick={() => start("review")}>复习 {state.reviewCount} 个</button>
        </Panel>
        <Panel title="错词听写">
          <p className="muted">按错误次数从高到低排序。</p>
          <button className="primary" disabled={state.wrongWords.length === 0} onClick={() => start("wrong", undefined, "meaning_listen_spell")}>重学错词</button>
        </Panel>
      </div>
    </div>
  );
}

function Checkins({ checkin, userName }: { checkin?: Checkin; userName: string }) {
  const items = [
    ["今日学习", checkin?.study_done],
    ["今日复习", checkin?.review_done],
    ["错词重学", checkin?.wrong_review_done],
  ];
  return (
    <Panel title={`${userName} 的打卡`}>
      <div className="check-list">
        {items.map(([label, done]) => <div className={done ? "done" : ""} key={label as string}><Check />{label}</div>)}
      </div>
      <p className="notice">{checkin?.completed_at ? "今天已完成打卡" : "三项都完成后自动打卡"}</p>
    </Panel>
  );
}

function CheckinStrip({ checkin }: { checkin?: Checkin }) {
  const done = [checkin?.study_done, checkin?.review_done, checkin?.wrong_review_done].filter(Boolean).length;
  return <div className="checkin-strip"><CalendarCheck /><span>{done}/3</span></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h3>{title}</h3>{children}</section>;
}

function Row({ title, meta, action, onClick }: { title: string; meta: string; action: string; onClick: () => void }) {
  return <div className="row"><div><strong>{title}</strong><span>{meta}</span></div><button onClick={onClick}>{action}</button></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function viewTitle(view: View) {
  return ({ home: "今日任务", import: "单词录入", groups: "单词组", learn: "学习", review: "复习", checkins: "打卡记录" })[view];
}

function modeLabel(mode: string) {
  return modes.find((item) => item.id === mode)?.label || "练习";
}

function speakIfNeeded(word: Word, mode: string) {
  if (mode !== "meaning_choice") speak(word.word);
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.85;
  window.speechSynthesis.speak(utterance);
}

async function api<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function usePracticeType() {
  return null as null | { session: Session; words: Word[]; index: number; answer: string; last?: { ok: boolean; correctWord: string } };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
