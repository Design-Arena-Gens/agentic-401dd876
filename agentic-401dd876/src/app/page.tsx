'use client';

import { FormEvent, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

type Task = {
  id: string;
  title: string;
  notes: string;
  scheduledFor: string;
  completed: boolean;
  notifiedAt: string | null;
  createdAt: string;
};

type TemplateTask = {
  title: string;
  notes: string;
  hour: number;
  minute: number;
};

type Template = {
  name: string;
  description: string;
  tasks: TemplateTask[];
};

type Alert = {
  id: string;
  taskId: string;
  message: string;
  triggeredAt: number;
};

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const STORAGE_KEY = 'agentic-401dd876::tasks';
const ALERT_DURATION_MS = 45000;

const templates: Template[] = [
  {
    name: 'Balanced Morning',
    description: 'A gentle start with movement, planning, and breakfast.',
    tasks: [
      {
        title: 'Wake up & stretch',
        notes: 'Light mobility routine to wake up your body.',
        hour: 7,
        minute: 0,
      },
      {
        title: 'Plan the day',
        notes: 'Review goals and top 3 priorities.',
        hour: 7,
        minute: 20,
      },
      {
        title: 'Healthy breakfast',
        notes: 'Keep it simple: oats or eggs + fruit.',
        hour: 7,
        minute: 45,
      },
    ],
  },
  {
    name: 'Productivity Sprint',
    description: 'Deep work blocks with reminders to move and hydrate.',
    tasks: [
      {
        title: 'Deep work block #1',
        notes: 'Focus on your most important task.',
        hour: 9,
        minute: 0,
      },
      {
        title: 'Hydration check-in',
        notes: 'Drink a full glass of water.',
        hour: 10,
        minute: 30,
      },
      {
        title: 'Reset walk',
        notes: 'Step outside for a 10 minute reset.',
        hour: 12,
        minute: 0,
      },
    ],
  },
  {
    name: 'Evening Wind Down',
    description: 'Prepare tomorrow and unplug with intention.',
    tasks: [
      {
        title: 'Tomorrow prep',
        notes: 'Lay out clothes & top priorities.',
        hour: 20,
        minute: 0,
      },
      {
        title: 'Digital sunset',
        notes: 'Screens off and switch to warm lights.',
        hour: 21,
        minute: 0,
      },
      {
        title: 'Gratitude journal',
        notes: 'Capture three things that went well.',
        hour: 21,
        minute: 30,
      },
    ],
  },
];

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toLocalInputValue = (date: Date) => {
  const copy = new Date(date.getTime());
  copy.setSeconds(0, 0);
  const offset = copy.getTimezoneOffset();
  const local = new Date(copy.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const getDefaultFormTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + (5 - (now.getMinutes() % 5 || 5)));
  now.setSeconds(0, 0);
  return toLocalInputValue(now);
};

const readTasks = (): Task[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Task[];
    return parsed
      .filter((task) => !!task && !!task.id && !!task.scheduledFor && !!task.title)
      .map((task) => ({
        ...task,
        notes: task.notes ?? '',
        notifiedAt: task.notifiedAt ?? null,
      }));
  } catch {
    return [];
  }
};

const sortTasks = (tasks: Task[]) =>
  [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    return new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime();
  });

const describeRelativeTime = (scheduledFor: string, baseline: number) => {
  const target = new Date(scheduledFor).getTime();
  const diff = target - baseline;
  const formatter = new Intl.RelativeTimeFormat(undefined, { style: 'long' });
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) {
    return 'now';
  }
  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  return formatter.format(hours, 'hour');
};

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const formatDateMeta = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(() => sortTasks(readTasks()));
  const [formTitle, setFormTitle] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formTime, setFormTime] = useState(getDefaultFormTime);
  const [, forcePermissionRefresh] = useReducer((value: number) => value + 1, 0);
  const notificationSupported = typeof window !== 'undefined' && 'Notification' in window;
  const notificationPermission: NotificationPermission = notificationSupported
    ? window.Notification.permission
    : 'denied';
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [now, setNow] = useState(() => Date.now());
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasHydratedRef = useRef(false);

  const persistTasks = useCallback((nextTasks: Task[]) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTasks));
  }, []);

  useEffect(() => {
    hasHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydratedRef.current) return;
    persistTasks(tasks);
  }, [tasks, persistTasks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ticker = window.setInterval(() => {
      setNow(Date.now());
    }, 15000);
    return () => {
      window.clearInterval(ticker);
    };
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (audioContextRef.current) return audioContextRef.current;
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    audioContextRef.current = ctx;
    return ctx;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resumeAudio = () => {
      const ctx = ensureAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => undefined);
      }
    };
    window.addEventListener('pointerdown', resumeAudio, { once: false });
    window.addEventListener('keydown', resumeAudio, { once: false });
    return () => {
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    };
  }, [ensureAudioContext]);

  const playAlarm = useCallback(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.5);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(now + 1.3);
  }, [ensureAudioContext]);

  const pushAlert = useCallback((alert: Alert) => {
    setActiveAlerts((prev) => [...prev, alert]);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        setActiveAlerts((prev) => prev.filter((item) => item.id !== alert.id));
      }, ALERT_DURATION_MS);
    }
  }, []);

  const triggerNotification = useCallback(
    (task: Task) => {
      const message = `${task.title} ${task.notes ? `• ${task.notes}` : ''}`.trim();
      if (notificationSupported && notificationPermission === 'granted') {
        new Notification('It is time!', {
          body: message,
          tag: task.id,
        });
      }
      if (typeof document !== 'undefined') {
        document.title = `⏰ ${task.title} — Daily Planner`;
      }
      playAlarm();
      pushAlert({
        id: createId(),
        taskId: task.id,
        message,
        triggeredAt: Date.now(),
      });
    },
    [notificationPermission, notificationSupported, playAlarm, pushAlert],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const interval = window.setInterval(() => {
      setTasks((prev) => {
        const now = Date.now();
        let changed = false;
        const next = prev.map((task) => {
          if (task.completed || task.notifiedAt) {
            return task;
          }
          const scheduled = new Date(task.scheduledFor).getTime();
          if (scheduled <= now) {
            changed = true;
            triggerNotification(task);
            return { ...task, notifiedAt: new Date().toISOString() };
          }
          return task;
        });
        return changed ? sortTasks(next) : prev;
      });
    }, 15000);
    return () => {
      window.clearInterval(interval);
    };
  }, [triggerNotification]);

  const upcomingTasks = useMemo(
    () => tasks.filter((task) => !task.completed).sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()),
    [tasks],
  );

  const completedTasks = useMemo(
    () => tasks.filter((task) => task.completed).sort((a, b) => new Date(b.scheduledFor).getTime() - new Date(a.scheduledFor).getTime()),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    switch (filter) {
      case 'upcoming':
        return upcomingTasks;
      case 'completed':
        return completedTasks;
      default:
        return tasks;
    }
  }, [filter, tasks, upcomingTasks, completedTasks]);

  const nextTask = upcomingTasks[0];
  const progress =
    tasks.length === 0
      ? 0
      : Math.round((completedTasks.length / tasks.length) * 100);

  const handleAddTask = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!formTitle.trim() || !formTime) {
        return;
      }
      const scheduled = new Date(formTime);
      if (Number.isNaN(scheduled.getTime())) {
        return;
      }
      const newTask: Task = {
        id: createId(),
        title: formTitle.trim(),
        notes: formNotes.trim(),
        scheduledFor: scheduled.toISOString(),
        completed: false,
        notifiedAt: null,
        createdAt: new Date().toISOString(),
      };
      setTasks((prev) => sortTasks([...prev, newTask]));
      setFormTitle('');
      setFormNotes('');
      setFormTime(getDefaultFormTime());
    },
    [formNotes, formTime, formTitle],
  );

  const handleToggleComplete = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? {
              ...task,
              completed: !task.completed,
            }
          : task,
      ),
    );
  }, []);

  const handleDeleteTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const handleSnoozeTask = useCallback((taskId: string, minutes = 5) => {
    setTasks((prev) =>
      sortTasks(
        prev.map((task) => {
          if (task.id !== taskId) return task;
          const newDate = new Date();
          newDate.setMinutes(newDate.getMinutes() + minutes);
          return {
            ...task,
            scheduledFor: newDate.toISOString(),
            notifiedAt: null,
            completed: false,
          };
        }),
      ),
    );
  }, []);

  const handleApplyTemplate = useCallback((template: Template) => {
    setTasks((prev) => {
      const now = new Date();
      const additions = template.tasks.map((item) => {
        const target = new Date(now);
        target.setHours(item.hour, item.minute, 0, 0);
        if (target.getTime() <= now.getTime()) {
          target.setDate(target.getDate() + 1);
        }
        return {
          id: createId(),
          title: item.title,
          notes: item.notes,
          scheduledFor: target.toISOString(),
          completed: false,
          notifiedAt: null,
          createdAt: new Date().toISOString(),
        } satisfies Task;
      });
      return sortTasks([...prev, ...additions]);
    });
  }, []);

  const resetDay = useCallback(() => {
    setTasks([]);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const requestNotificationPermission = useCallback(() => {
    if (!notificationSupported) return;
    window.Notification.requestPermission().then(() => {
      forcePermissionRefresh();
    });
  }, [notificationSupported, forcePermissionRefresh]);

  return (
    <div className="min-h-screen bg-slate-950 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10 md:px-10">
        <header className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-md md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-300">
              Daily Focus
            </p>
            <h1 className="mt-1 text-3xl font-semibold md:text-4xl">
              Agentic Day Planner
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-300 md:text-base">
              Preload your day with planned actions, receive alerts at the right
              moments, and keep momentum with gentle reminders and an at-a-glance
              agenda.
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Progress</span>
              <span className="font-semibold text-slate-100">
                {progress}%
              </span>
            </div>
            <div className="h-2 w-48 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <button
              type="button"
              onClick={requestNotificationPermission}
              disabled={!notificationSupported || notificationPermission === 'granted'}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-900 disabled:text-emerald-300"
            >
              {notificationPermission === 'granted'
                ? 'Notifications Ready'
                : notificationSupported
                ? 'Enable Notifications'
                : 'Notifications Unsupported'}
            </button>
          </div>
        </header>

        {nextTask ? (
          <section className="flex flex-col gap-4 rounded-3xl border border-amber-200/20 bg-amber-200/10 p-6 text-amber-50 shadow-xl shadow-amber-500/10 backdrop-blur">
            <div className="flex items-center gap-2 text-sm uppercase tracking-wider text-amber-200/80">
              <span className="inline-flex h-2 w-2 rounded-full bg-amber-400" />
              Up next
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold text-amber-50">
                {nextTask.title}
              </h2>
              {nextTask.notes ? (
                <p className="text-sm text-amber-100/90">{nextTask.notes}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-amber-100/80">
              <div className="flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-200/10 px-3 py-1">
                <span className="font-semibold">{formatClock(nextTask.scheduledFor)}</span>
                <span className="h-1 w-1 rounded-full bg-amber-300/70" />
                <span>{describeRelativeTime(nextTask.scheduledFor, now)}</span>
              </div>
              <button
                type="button"
                onClick={() => handleSnoozeTask(nextTask.id)}
                className="rounded-full border border-amber-200/40 px-4 py-1 text-xs font-semibold uppercase tracking-widest hover:bg-amber-200/20"
              >
                Snooze 5 min
              </button>
            </div>
          </section>
        ) : null}

        {activeAlerts.length > 0 ? (
          <section className="space-y-3 rounded-3xl border border-emerald-300/20 bg-emerald-200/10 p-5 text-emerald-50 shadow-lg shadow-emerald-500/10">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex flex-col gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm"
              >
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-emerald-200/80">
                  <span>Alarm triggered</span>
                  <span>{new Date(alert.triggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-base font-semibold leading-tight text-emerald-50">
                  {alert.message}
                </p>
              </div>
            ))}
          </section>
        ) : null}

        <section className="grid gap-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur lg:grid-cols-[2fr,3fr]">
          <form className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/30 p-5" onSubmit={handleAddTask}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-300">
                Activity title
              </label>
              <input
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder="Plan focused work block"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-slate-100 outline-none ring-emerald-400/40 transition focus:ring"
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-300">
                Notes
              </label>
              <textarea
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
                placeholder="Resources, intention, or prep checklist…"
                rows={3}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-slate-100 outline-none ring-emerald-400/40 transition focus:ring"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-300">
                Time
              </label>
              <input
                type="datetime-local"
                value={formTime}
                onChange={(event) => setFormTime(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-slate-100 outline-none ring-emerald-400/40 transition focus:ring"
                required
              />
            </div>

            <button
              type="submit"
              className="mt-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-emerald-950 transition hover:bg-emerald-400"
            >
              Add to plan
            </button>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold uppercase tracking-[0.4em] text-slate-300">
                Templates
              </span>
              {templates.map((template) => (
                <button
                  key={template.name}
                  type="button"
                  onClick={() => handleApplyTemplate(template)}
                  className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:bg-white/20"
                >
                  {template.name}
                </button>
              ))}
            </div>
          </form>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-slate-300">
                {tasks.length > 0
                  ? `${upcomingTasks.length} upcoming · ${completedTasks.length} completed`
                  : 'No activities planned yet'}
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em]">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`rounded-full border px-3 py-1 transition ${
                    filter === 'all'
                      ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
                      : 'border-white/10 bg-white/10 text-slate-300 hover:border-white/20 hover:bg-white/15'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('upcoming')}
                  className={`rounded-full border px-3 py-1 transition ${
                    filter === 'upcoming'
                      ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
                      : 'border-white/10 bg-white/10 text-slate-300 hover:border-white/20 hover:bg-white/15'
                  }`}
                >
                  Upcoming
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('completed')}
                  className={`rounded-full border px-3 py-1 transition ${
                    filter === 'completed'
                      ? 'border-emerald-400 bg-emerald-400/20 text-emerald-200'
                      : 'border-white/10 bg-white/10 text-slate-300 hover:border-white/20 hover:bg-white/15'
                  }`}
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={resetDay}
                  className="rounded-full border border-rose-400/60 bg-rose-400/20 px-3 py-1 text-rose-100 transition hover:bg-rose-400/30"
                >
                  Reset day
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {filteredTasks.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-center text-sm text-slate-400">
                  Nothing to show here. Add activities or load a template to get
                  started.
                </div>
              ) : null}

              {filteredTasks.map((task) => {
                const scheduledTime = new Date(task.scheduledFor);
                const isOverdue = !task.completed && scheduledTime.getTime() < now;
                const wasNotified = Boolean(task.notifiedAt);
                return (
                  <article
                    key={task.id}
                    className="rounded-2xl border border-white/10 bg-black/40 p-5 transition hover:border-emerald-400/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleComplete(task.id)}
                          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold transition ${
                            task.completed
                              ? 'border-emerald-400 bg-emerald-400 text-emerald-950'
                              : 'border-white/20 bg-black/60 text-slate-300 hover:border-white/40'
                          }`}
                          aria-label={`Mark ${task.title} as ${task.completed ? 'pending' : 'done'}`}
                        >
                          {task.completed ? '✓' : ''}
                        </button>
                        <div>
                          <h3 className="text-lg font-semibold text-slate-100">
                            {task.title}
                          </h3>
                          {task.notes ? (
                            <p className="text-sm text-slate-400">{task.notes}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 text-xs text-slate-300">
                        <span
                          className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
                            task.completed
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                              : isOverdue
                              ? 'border-rose-400/60 bg-rose-500/10 text-rose-200'
                              : 'border-white/15 bg-white/10'
                          }`}
                        >
                          {formatClock(task.scheduledFor)}
                          <span className="h-1 w-1 rounded-full bg-white/40" />
                          {describeRelativeTime(task.scheduledFor, now)}
                        </span>
                        <span className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-500">
                          {formatDateMeta(task.scheduledFor)}
                        </span>
                        {wasNotified ? (
                          <span className="rounded-full border border-amber-200/30 bg-amber-100/10 px-2 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-amber-200">
                            Alarm sent
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      {!task.completed ? (
                        <button
                          type="button"
                          onClick={() => handleSnoozeTask(task.id)}
                          className="rounded-full border border-white/20 px-3 py-1 transition hover:border-emerald-300/60 hover:bg-emerald-300/10 hover:text-emerald-200"
                        >
                          Snooze 5 min
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => handleDeleteTask(task.id)}
                        className="rounded-full border border-white/20 px-3 py-1 transition hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-200"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300">
          <h2 className="text-lg font-semibold text-slate-100">
            How reminders work
          </h2>
          <ul className="mt-3 space-y-2">
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              <p>
                Schedule every task with a start time. The planner will check every
                15 seconds and trigger an alarm as soon as the scheduled moment
                arrives.
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              <p>
                Grant notification permission to receive native browser alerts in
                addition to the in-app alarm pulse and chime.
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-emerald-300" />
              <p>
                Snooze to push a task 5 minutes ahead, or reset the day to clear
                the board and start fresh.
              </p>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
