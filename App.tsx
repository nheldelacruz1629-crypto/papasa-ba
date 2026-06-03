import React, { useState, useEffect } from "react"
import {
  Plus, ChevronRight, ArrowLeft, X, BookOpen,
  Trash2, Check, BarChart2, AlertTriangle,
} from "lucide-react"

// ==========================================
// TYPES & INTERFACES
// ==========================================
type Page = "dashboard" | "c1" | "c2" | "c3" | "c4" | "subject"
type GradingSystem = "zero-based" | "weighted" | "base-custom"
type ZeroFormula = "percentage"

interface Column { id: string; label: string; score: string; total: string }
interface AssessmentType { id: string; name: string; weight: string; columns: Column[] }
interface Subject {
  id: string
  name: string
  gradingSystem: GradingSystem
  zeroFormula?: ZeroFormula
  baseValue?: string
  assessmentTypes: AssessmentType[]
}

type GradeResult = {
  grade: number
  breakdown: { name: string; pct: number; weight: number }[]
  error?: string
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = data?.error || data?.message || res.statusText || "Request failed"
    throw new Error(message)
  }
  return data as T
}

// ==========================================
// UTILITY FUNCTIONS & CALCULATIONS
// ==========================================
const uid = () => Math.random().toString(36).slice(2)

function getPupEquivalent(grade: number) {
  if (grade >= 96.5) return 1.0
  if (grade >= 93.5) return 1.25
  if (grade >= 90.5) return 1.5
  if (grade >= 87.5) return 1.75
  if (grade >= 84.5) return 2.0
  if (grade >= 81.5) return 2.25
  if (grade >= 78.5) return 2.5
  if (grade >= 75.5) return 2.75
  if (grade >= 74.5) return 3.0
  return 5.0
}

type StoredGradingSystem = GradingSystem | "base-50" | "base-30"
type StoredZeroFormula = ZeroFormula | "transmuted"

interface StoredSubject extends Omit<Subject, "gradingSystem" | "zeroFormula"> {
  gradingSystem: StoredGradingSystem
  zeroFormula?: StoredZeroFormula
}

const isBaseSystem = (gs?: GradingSystem): gs is "base-custom" => gs === "base-custom"

const usesWeights = (gs?: GradingSystem) => gs === "zero-based" || gs === "weighted" || isBaseSystem(gs)

const baseValueError = (value?: string | number) => {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return "Base value is required."
  if (isNaN(+trimmed) || +trimmed < 0 || +trimmed > 100) {
    return "Base value must be between 0 and 100."
  }
  return null
}

const baseValueFor = (gs: GradingSystem, value?: string | number) => {
  if (gs === "base-custom") {
    return baseValueError(value) ? null : +String(value)
  }
  return null
}

function computeResult(sub: Subject): GradeResult | null {
  for (const t of sub.assessmentTypes) {
    if (!t.columns.length) return null
    for (const c of t.columns) {
      if (c.score === "" || c.total === "") return null
      if (isNaN(+c.score) || isNaN(+c.total) || +c.total <= 0) return null
    }
  }

  const bd = sub.assessmentTypes.map(t => {
    const totalScore = t.columns.reduce((a, c) => a + +c.score, 0)
    const totalMax = t.columns.reduce((a, c) => a + +c.total, 0)
    return {
      name: t.name,
      pct: totalMax > 0 ? (totalScore / totalMax) * 100 : 0,
      weight: +t.weight,
    }
  })

  if (sub.gradingSystem === "zero-based") {
    const tw = bd.reduce((sum, b) => sum + b.weight, 0)
    const effectiveBreakdown = tw > 0
      ? bd
      : bd.map(b => ({ ...b, weight: bd.length ? 100 / bd.length : 0 }))
    const effectiveWeightTotal = effectiveBreakdown.reduce((sum, b) => sum + b.weight, 0)
    if (Math.abs(effectiveWeightTotal - 100) > 0.5) {
      return { grade: 0, breakdown: effectiveBreakdown, error: `Weights total ${effectiveWeightTotal.toFixed(1)}% — must equal 100%` }
    }
    const grade = effectiveBreakdown.reduce((sum, b) => sum + (b.pct * b.weight) / 100, 0)
    return { grade: +grade.toFixed(2), breakdown: effectiveBreakdown }
  }

  if (usesWeights(sub.gradingSystem)) {
    const tw = bd.reduce((s, b) => s + b.weight, 0)
    if (Math.abs(tw - 100) > 0.5) {
      return { grade: 0, breakdown: bd, error: `Weights total ${tw.toFixed(1)}% — must equal 100%` }
    }
    const computedGrade = bd.reduce((s, b) => s + (b.pct * b.weight) / 100, 0)
    if (sub.gradingSystem === "weighted") {
      return { grade: +computedGrade.toFixed(2), breakdown: bd }
    }
    const baseValue = baseValueFor(sub.gradingSystem, sub.baseValue)
    if (baseValue === null) {
      const message = baseValueError(sub.baseValue) || "Base value is required."
      return { grade: 0, breakdown: bd, error: message }
    }
    const finalGrade = baseValue + computedGrade * ((100 - baseValue) / 100)
    return { grade: +finalGrade.toFixed(2), breakdown: bd }
  }
  return null
}

function isReady(sub: Subject) {
  if (!sub.assessmentTypes.length) return false
  return sub.assessmentTypes.every(
    t => t.columns.length && t.columns.every(c => c.score !== "" && c.total !== "" && !isNaN(+c.score) && !isNaN(+c.total) && +c.total > 0)
  )
}

function gradeInfo(g: number, gs: GradingSystem) {
  const pupEquivalent = getPupEquivalent(g)
  return g >= 75
    ? { desc: "Passed", pass: true, pupEquivalent }
    : { desc: "Failed", pass: false, pupEquivalent }
}

function gsLabel(gs: GradingSystem, baseValue?: string) {
  if (gs === "weighted") return "Custom Weighted"
  if (gs === "base-custom") {
    const display = String(baseValue ?? "").trim()
    return display ? `Custom Base · ${display}` : "Custom Base"
  }
  return "Zero-Based · Percentage"
}

const weightSum = (types: AssessmentType[]) =>
  types.reduce((sum, t) => sum + (isNaN(+t.weight) ? 0 : +t.weight), 0)

// ==========================================
// REUSABLE PRESENTATIONAL COMPONENTS
// ==========================================
function UInput({
  label, type = "text", value, onChange, placeholder, onKeyDown, right,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent) => void
  right?: React.ReactNode
}) {
  return (
    <div className="relative">
      <label className="block text-sm font-semibold text-foreground/70 mb-1">{label}</label>
      <div className="relative">
        <input
          type={type} value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent border-0 border-b-2 border-foreground/25 focus:border-primary pb-1.5 pr-8 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none transition-colors"
        />
        {right && <div className="absolute right-0 top-0">{right}</div>}
      </div>
    </div>
  )
}

function BluePanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-primary rounded-4xl p-6 shadow-xl shadow-primary/20 text-white ${className}`}>
      {children}
    </div>
  )
}

function GrayCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-muted/50 rounded-2xl p-6 shadow-inner border border-foreground/5 ${className}`}>
      {children}
    </div>
  )
}

function ScoreRow({ col, onScore, onTotal, onDelete }: {
  col: Column
  onScore: (v: string) => void
  onTotal: (v: string) => void
  onDelete?: () => void
}) {
  const pct = col.score !== "" && col.total !== "" && +col.total > 0
    ? ((+col.score / +col.total) * 100).toFixed(0) : null

  return (
    <div className="flex items-end gap-3 py-2.5 border-b border-foreground/10 last:border-0">
      <span className="text-sm font-semibold text-foreground w-28 shrink-0 pb-1 truncate">{col.label}</span>
      <div className="flex items-end gap-2 flex-1">
        <div className="flex-1">
          <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block mb-1">Score</label>
          <input
            type="number" value={col.score} onChange={e => onScore(e.target.value)} min={0}
            className="w-full bg-transparent border-0 border-b-2 border-foreground/25 focus:border-primary pb-1 text-sm text-foreground focus:outline-none transition-colors [appearance:textfield]"
          />
        </div>
        <span className="text-foreground/40 pb-1 text-sm">/</span>
        <div className="flex-1">
          <label className="text-[10px] font-bold text-foreground/50 uppercase tracking-wider block mb-1">Total</label>
          <input
            type="number" value={col.total} onChange={e => onTotal(e.target.value)} min={1}
            className="w-full bg-transparent border-0 border-b-2 border-foreground/25 focus:border-primary pb-1 text-sm text-foreground focus:outline-none transition-colors [appearance:textfield]"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pb-1">
        <div className="w-10 text-right">
          {pct !== null ? (
            <span className="text-xs font-bold text-foreground/50">{pct}%</span>
          ) : (
            <span className="text-xs text-foreground/20">—</span>
          )}
        </div>
        {onDelete && (
          <button onClick={onDelete} className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function StepBar({ step }: { step: number }) {
  const STEPS = ["Subject", "Grading", "Assessments", "Scores"]
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
            i < step ? "bg-white text-primary" :
            i === step ? "bg-white text-primary ring-4 ring-white/30" :
            "bg-white/20 text-white/60"
          }`}>
            {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-6 h-0.5 rounded-full ${i < step ? "bg-white/60" : "bg-white/20"}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ==========================================
// MAIN APPLICATION COMPONENT
// ==========================================
export default function App() {
  const [page, setPage] = useState<Page>("dashboard")
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [backendStatus, setBackendStatus] = useState<"connecting" | "connected" | "error">("connecting")
  const [backendError, setBackendError] = useState<string | null>(null)

  const [draft, setDraft] = useState<{
    name: string
    gradingSystem?: GradingSystem
    zeroFormula?: ZeroFormula
    baseValue?: string
    assessmentTypes: AssessmentType[]
  }>({ name: "", baseValue: "", assessmentTypes: [] })

  const [activeId, setActiveId] = useState<string | null>(null)
  const [newColLabel, setNewColLabel] = useState<Record<string, string>>({})
  const [newSubjectColLabel, setNewSubjectColLabel] = useState<Record<string, string>>({})
  const [subjectEditError, setSubjectEditError] = useState<string | null>(null)

  const activeSub = subjects.find(s => s.id === activeId) ?? null
  const draftUsesWeights = usesWeights(draft.gradingSystem)
  const draftWeightTotal = draftUsesWeights ? weightSum(draft.assessmentTypes) : 0
  const draftWeightError = draftUsesWeights
    ? draft.assessmentTypes.some(t => !t.weight || isNaN(+t.weight) || +t.weight <= 0 || +t.weight > 100)
      ? "Each weight must be between 1 and 100%."
      : Math.abs(draftWeightTotal - 100) > 0.5
        ? `Weights total ${draftWeightTotal.toFixed(1)}% — must equal 100%.`
        : null
    : null
  const draftBaseError = draft.gradingSystem === "base-custom" ? baseValueError(draft.baseValue) : null
  const draftConfigError = draftWeightError || draftBaseError
  const activeUsesWeights = usesWeights(activeSub?.gradingSystem)
  const activeWeightTotal = activeUsesWeights ? weightSum(activeSub?.assessmentTypes || []) : 0
  const activeWeightWarning = activeUsesWeights && Math.abs(activeWeightTotal - 100) > 0.5
    ? `Weights total ${activeWeightTotal.toFixed(1)}% — must equal 100%.`
    : null
  const activeBaseError = activeSub?.gradingSystem === "base-custom" ? baseValueError(activeSub.baseValue) : null

  const normalizeSubject = (subject: StoredSubject): Subject => {
    const rawSystem = subject.gradingSystem
    let gradingSystem: GradingSystem = "zero-based"
    let baseValue: string | undefined = undefined

    if (rawSystem === "weighted") {
      gradingSystem = "weighted"
    } else if (rawSystem === "base-custom") {
      gradingSystem = "base-custom"
      baseValue = subject.baseValue
    } else if (rawSystem === "base-50") {
      gradingSystem = "base-custom"
      baseValue = subject.baseValue ?? "50"
    } else if (rawSystem === "base-30") {
      gradingSystem = "base-custom"
      baseValue = subject.baseValue ?? "30"
    }

    const zeroFormula = rawSystem === "zero-based" ? "percentage" : undefined
    const assessmentTypes = subject.assessmentTypes.map(type => ({ ...type }))
    if (gradingSystem === "zero-based" && assessmentTypes.length) {
      const hasWeights = assessmentTypes.some(type => String(type.weight ?? "").trim() !== "")
      if (!hasWeights) {
        const evenWeight = Math.floor((100 / assessmentTypes.length) * 100) / 100
        let runningTotal = 0
        assessmentTypes.forEach((type, index) => {
          const value = index === assessmentTypes.length - 1
            ? +(100 - runningTotal).toFixed(2)
            : evenWeight
          runningTotal += value
          type.weight = value.toFixed(2)
        })
      }
    }
    return {
      ...subject,
      gradingSystem,
      zeroFormula,
      baseValue,
      assessmentTypes,
    }
  }

  useEffect(() => {
    const loadSubjects = async () => {
      setBackendStatus("connecting")
      setBackendError(null)
      try {
        const data = await api<{ subjects: StoredSubject[] }>("/api/ui/subjects")
        setSubjects((data.subjects || []).map(normalizeSubject))
        setBackendStatus("connected")
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to connect to backend"
        setBackendStatus("error")
        setBackendError(msg)
      }
    }
    loadSubjects()
  }, [])

  const startCreate = () => {
    setDraft({ name: "", baseValue: "", assessmentTypes: [] })
    setNewColLabel({})
    setPage("c1")
  }

  const chooseGS = (gs: GradingSystem) => {
    const types = [{ id: uid(), name: "", weight: usesWeights(gs) ? "" : "100", columns: [] }]
    const baseValue = gs === "base-custom" ? "" : undefined
    setDraft(p => ({
      ...p,
      gradingSystem: gs,
      zeroFormula: gs === "zero-based" ? "percentage" : undefined,
      baseValue,
      assessmentTypes: types,
    }))
    setNewColLabel({})
    setPage("c3")
  }

  const updType = (id: string, f: "name" | "weight", v: string) =>
    setDraft(p => ({ ...p, assessmentTypes: p.assessmentTypes.map(t => t.id === id ? { ...t, [f]: v } : t) }))

  const delType = (id: string) =>
    setDraft(p => ({ ...p, assessmentTypes: p.assessmentTypes.filter(t => t.id !== id) }))

  const addType = () =>
    setDraft(p => ({ ...p, assessmentTypes: [...p.assessmentTypes, { id: uid(), name: "", weight: "", columns: [] }] }))

  const addColToDraft = (tid: string) => {
    const lbl = (newColLabel[tid] || "").trim()
    if (!lbl) return
    setDraft(p => ({
      ...p,
      assessmentTypes: p.assessmentTypes.map(t =>
        t.id === tid ? { ...t, columns: [...t.columns, { id: uid(), label: lbl, score: "", total: "" }] } : t
      ),
    }))
    setNewColLabel(p => ({ ...p, [tid]: "" }))
  }

  const delColFromDraft = (tid: string, cid: string) =>
    setDraft(p => ({
      ...p,
      assessmentTypes: p.assessmentTypes.map(t =>
        t.id === tid ? { ...t, columns: t.columns.filter(c => c.id !== cid) } : t
      ),
    }))

  const updDraftScore = (tid: string, cid: string, f: "score" | "total", v: string) =>
    setDraft(p => ({
      ...p,
      assessmentTypes: p.assessmentTypes.map(t =>
        t.id === tid ? { ...t, columns: t.columns.map(c => c.id === cid ? { ...c, [f]: v } : c) } : t
      ),
    }))

  const canGoC4 = () => {
    const ts = draft.assessmentTypes
    if (!ts.length) return false
    if (ts.some(t => !t.name.trim())) return false
    if (ts.some(t => !t.columns.length)) return false
    if (draftUsesWeights) {
      if (ts.some(t => !t.weight || isNaN(+t.weight) || +t.weight <= 0 || +t.weight > 100)) return false
      if (Math.abs(weightSum(ts) - 100) > 0.5) return false
    }
    if (draft.gradingSystem === "base-custom" && baseValueError(draft.baseValue)) return false
    return true
  }

  const saveSubject = async () => {
    const sub: Subject = {
      id: uid(), name: draft.name,
      gradingSystem: draft.gradingSystem!,
      zeroFormula: draft.zeroFormula,
      baseValue: draft.baseValue,
      assessmentTypes: draft.assessmentTypes,
    }
    try {
      const data = await api<{ subject: Subject }>("/api/ui/subjects", {
        method: "POST",
        body: JSON.stringify(sub),
      })
      setSubjects(p => [...p, data.subject])
      setBackendStatus("connected")
      setBackendError(null)
      setPage("dashboard")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save subject"
      setBackendStatus("error")
      setBackendError(msg)
    }
  }

  const syncSubject = async (subject: Subject) => {
    try {
      await api(`/api/ui/subjects/${subject.id}`, {
        method: "PUT",
        body: JSON.stringify(subject),
      })
      setBackendStatus("connected")
      setBackendError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to sync subject"
      setBackendStatus("error")
      setBackendError(msg)
    }
  }

  const updateSubject = (sid: string, updater: (s: Subject) => Subject) => {
    setSubjects(p => {
      let didChange = false
      const next = p.map(s => {
        if (s.id !== sid) return s
        const updated = updater(s)
        if (updated !== s) didChange = true
        return updated
      })
      const updated = next.find(s => s.id === sid)
      if (updated && didChange) {
        void syncSubject(updated)
      }
      return next
    })
  }

  const deleteSubject = async (id: string) => {
    try {
      await api(`/api/ui/subjects/${id}`, { method: "DELETE" })
      setSubjects(p => p.filter(s => s.id !== id))
      setActiveId(null)
      setBackendStatus("connected")
      setBackendError(null)
      setPage("dashboard")
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete subject"
      setBackendStatus("error")
      setBackendError(msg)
    }
  }

  const updScore = (sid: string, tid: string, cid: string, f: "score" | "total", v: string) =>
    updateSubject(sid, s => ({
      ...s, assessmentTypes: s.assessmentTypes.map(t =>
        t.id === tid ? { ...t, columns: t.columns.map(c => c.id === cid ? { ...c, [f]: v } : c) } : t
      ),
    }))

  const updSubjectType = (sid: string, tid: string, f: "name" | "weight", v: string) =>
    updateSubject(sid, s => ({
      ...s, assessmentTypes: s.assessmentTypes.map(t => t.id === tid ? { ...t, [f]: v } : t),
    }))

  const updSubjectWeight = (sid: string, tid: string, v: string) => {
    if (v !== "" && (isNaN(+v) || +v <= 0 || +v > 100)) {
      setSubjectEditError("Weight must be between 1 and 100%.")
      return
    }
    updateSubject(sid, s => {
      const nextTypes = s.assessmentTypes.map(t => t.id === tid ? { ...t, weight: v } : t)
      const total = weightSum(nextTypes)
      if (total > 100) {
        setSubjectEditError(`Weights total ${total.toFixed(1)}% — must not exceed 100%.`)
        return s
      }
      setSubjectEditError(null)
      return { ...s, assessmentTypes: nextTypes }
    })
  }

  const updSubjectBaseValue = (sid: string, v: string) =>
    updateSubject(sid, s => ({ ...s, baseValue: v }))

  const addTypeToSubject = (sid: string) =>
    updateSubject(sid, s => ({
      ...s,
      assessmentTypes: [...s.assessmentTypes, { id: uid(), name: "", weight: "", columns: [] }],
    }))

  const delTypeFromSubject = (sid: string, tid: string) =>
    updateSubject(sid, s => ({
      ...s, assessmentTypes: s.assessmentTypes.filter(t => t.id !== tid),
    }))

  const addColToSubject = (sid: string, tid: string) => {
    const lbl = (newSubjectColLabel[tid] || "").trim()
    if (!lbl) return
    updateSubject(sid, s => ({
      ...s,
      assessmentTypes: s.assessmentTypes.map(t =>
        t.id === tid ? { ...t, columns: [...t.columns, { id: uid(), label: lbl, score: "", total: "" }] } : t
      ),
    }))
    setNewSubjectColLabel(p => ({ ...p, [tid]: "" }))
  }

  const delColFromSubject = (sid: string, tid: string, cid: string) =>
    updateSubject(sid, s => ({
      ...s,
      assessmentTypes: s.assessmentTypes.map(t =>
        t.id === tid ? { ...t, columns: t.columns.filter(c => c.id !== cid) } : t
      ),
    }))

  const stepIdx = ({ c1: 0, c2: 1, c3: 2, c4: 3 } as Record<string, number>)[page] ?? -1

  // ==========================================
  // UNIFIED CONTAINER ROUTING ENGINE
  // ==========================================
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      {page === "dashboard" && (
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              <span className="font-black text-primary text-base tracking-wide uppercase">PasadoBa?</span>
            </div>
            <span className={`text-xs px-3 py-1 rounded-full font-semibold border shadow-sm ${
              backendStatus === "connected"
                ? "text-green-700 bg-green-50 border-green-200"
                : backendStatus === "connecting"
                  ? "text-muted-foreground bg-muted border-foreground/5"
                  : "text-red-600 bg-red-50 border-red-200"
            }`}>
              {backendStatus === "connected"
                ? "Backend Connected"
                : backendStatus === "connecting"
                  ? "Connecting..."
                  : "Backend Offline"}
            </span>
          </div>
          {backendStatus === "error" && backendError && (
            <p className="text-xs text-red-600 mb-4">{backendError}</p>
          )}

          <BluePanel>
            <div className="mb-5">
              <h1 className="text-xl font-black text-white">My Subjects</h1>
              <p className="text-white/60 text-xs font-medium mt-0.5">
                {subjects.length} subject{subjects.length !== 1 ? "s" : ""} tracked
              </p>
            </div>

            {subjects.length === 0 ? (
              <GrayCard className="text-center py-12">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <BookOpen className="w-7 h-7 text-primary" />
                </div>
                <p className="font-bold mb-1 text-foreground">No subjects yet</p>
                <p className="text-sm text-muted-foreground mb-5">Add your first subject to start tracking</p>
                <button onClick={startCreate}
                  className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-2xl text-sm font-bold hover:bg-secondary transition-all shadow-md">
                  <Plus className="w-4 h-4" /> Add Subject
                </button>
              </GrayCard>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {subjects.map(sub => {
                  const ready = isReady(sub)
                  const result = ready ? computeResult(sub) : null
                  const info = result && !result.error ? gradeInfo(result.grade, sub.gradingSystem) : null
                  const totalItems = sub.assessmentTypes.reduce((a, t) => a + t.columns.length, 0)
                  const filledItems = sub.assessmentTypes.reduce(
                    (a, t) => a + t.columns.filter(c => c.score !== "" && c.total !== "").length, 0
                  )

                  return (
                    <button
                      key={sub.id}
                      onClick={() => { setActiveId(sub.id); setPage("subject") }}
                      className="bg-card text-foreground rounded-2xl p-5 text-left hover:shadow-md transition-all group border border-foreground/5 flex flex-col justify-between min-h-40"
                    >
                      <div className="w-full">
                        <div className="flex items-start justify-between mb-3 w-full">
                          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                            <BookOpen className="w-5 h-5 text-primary" />
                          </div>
                          {info ? (
                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${
                              info.pass ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                            }`}>
                              {info.desc}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-primary/10 text-primary uppercase tracking-wider">
                              {filledItems}/{totalItems} Items
                            </span>
                          )}
                        </div>

                        <h3 className="font-black text-base mb-0.5 leading-tight truncate">{sub.name}</h3>
                        <p className="text-xs text-muted-foreground mb-3 font-semibold">
                          {gsLabel(sub.gradingSystem, sub.baseValue)}
                        </p>
                      </div>

                      <div className="w-full">
                        {result && !result.error ? (
                          <div className="flex items-baseline gap-1.5">
                            <span className={`text-4xl font-black leading-none ${info?.pass ? "text-green-600" : "text-red-500"}`}>
                              {result.grade}
                            </span>
                            <span className="text-xs text-muted-foreground font-semibold">/100</span>
                            <span className="text-xs font-semibold text-muted-foreground">
                              PUP {info?.pupEquivalent.toFixed(2)}
                            </span>
                          </div>
                        ) : (
                          <div>
                            <div className="w-full bg-primary/10 rounded-full h-2 overflow-hidden mb-1">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: totalItems > 0 ? `${(filledItems / totalItems) * 100}%` : "0%" }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground font-medium">
                              {totalItems === 0 ? "No items configured" : `${filledItems} of ${totalItems} scores entered`}
                            </p>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
                
                <button onClick={startCreate} className="border-2 border-dashed border-white/20 hover:border-white/40 rounded-2xl p-5 flex flex-col items-center justify-center text-center text-white/60 hover:text-white transition-all gap-2 min-h-40">
                  <Plus className="w-6 h-6" />
                  <span className="text-xs font-bold">Track Another Subject</span>
                </button>
              </div>
            )}
          </BluePanel>
        </div>
      )}

      {page === "c1" && (
        <div className="max-w-md mx-auto px-4 py-16">
          <BluePanel>
            <StepBar step={stepIdx} />
            <h2 className="text-2xl font-black text-white mb-2">Subject Name</h2>
            <p className="text-white/60 text-xs mb-6">What subject or course identifier are we tracking?</p>

            <div className="bg-card rounded-2xl p-6 text-foreground mb-6 shadow-inner">
              <UInput
                label="Subject / Course Code"
                placeholder="e.g., CPE 311, Physics 2"
                value={draft.name}
                onChange={v => setDraft(p => ({ ...p, name: v }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <button onClick={() => setPage("dashboard")} className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white font-bold transition-colors">
                <ArrowLeft className="w-4 h-4" /> Cancel
              </button>
              <button
                onClick={() => setPage("c2")}
                disabled={!draft.name.trim()}
                className="inline-flex items-center gap-1.5 bg-white text-primary px-5 py-2.5 rounded-2xl text-sm font-bold shadow-md hover:bg-white/90 disabled:opacity-40 transition-all"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </BluePanel>
        </div>
      )}

      {page === "c2" && (
        <div className="max-w-md mx-auto px-4 py-12">
          <BluePanel>
            <StepBar step={stepIdx} />
            <h2 className="text-3xl font-black text-white mb-0.5">Grading system</h2>
            <p className="text-white/70 text-sm mb-6">
              How is <span className="font-bold text-white">{draft.name || "OOP"}</span> graded?
            </p>

            <div className="space-y-4 text-foreground mb-6">
              {/* CUSTOM BASE SELECTION */}
              <button
                onClick={() => chooseGS("base-custom")}
                className="w-full bg-[#edf0f5] hover:bg-white rounded-3xl p-5 text-left transition-all flex items-center justify-between group shadow-sm"
              >
                <div className="space-y-1">
                  <span className="block font-bold text-[#1e293b] text-base">Custom Base</span>
                  <span className="block text-xs text-[#64748b]">Base + (Computed Grade × (100 - Base)%)</span>
                  <span className="inline-block bg-[#cbd5e1] text-[#475569] text-[10px] font-bold px-2.5 py-0.5 mt-1 rounded-full">
                    Set your own base
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-[#94a3b8] transition-transform group-hover:translate-x-0.5" />
              </button>

              {/* ZERO-BASED PERCENTAGE SELECTION */}
              <button 
                onClick={() => chooseGS("zero-based")} 
                className="w-full bg-[#edf0f5] hover:bg-white rounded-3xl p-5 text-left transition-all flex items-center justify-between group shadow-sm"
              >
                <div className="space-y-1">
                  <span className="block font-bold text-[#1e293b] text-base">Zero-Based · Percentage</span>
                  <span className="block text-xs text-[#64748b]">Score ÷ Total × 100, then category weights apply</span>
                  <span className="inline-block bg-[#cbd5e1] text-[#475569] text-[10px] font-bold px-2.5 py-0.5 mt-1 rounded-full">
                    Weighted Percentage
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-[#94a3b8] transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>

            <button onClick={() => setPage("c1")} className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white font-bold transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </BluePanel>
        </div>
      )}

      {page === "c3" && (
        <div className="max-w-2xl mx-auto px-4 py-8">
          <BluePanel>
            <StepBar step={stepIdx} />
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-2xl font-black text-white">Configure Assessments</h2>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/20 uppercase tracking-wide">
                {gsLabel(draft.gradingSystem!, draft.baseValue)}
              </span>
            </div>
            <p className="text-white/60 text-xs mb-6">Map out individual tracking parameters and column identifiers.</p>

            <div className="space-y-4 text-foreground mb-6">
              {draft.assessmentTypes.map((type, tIdx) => (
                <div key={type.id} className="bg-card rounded-2xl p-5 border border-foreground/5 shadow-md">
                  <div className="flex gap-3 mb-4 items-end">
                    <div className="flex-1">
                      <UInput
                        label={draftUsesWeights ? `Category ${tIdx + 1} Name` : "Category Name"}
                        placeholder="e.g., Quizzes, Midterms"
                        value={type.name}
                        onChange={v => updType(type.id, "name", v)}
                      />
                    </div>
                    {draftUsesWeights && (
                      <div className="w-24">
                        <UInput
                          label="Weight (%)"
                          placeholder="e.g., 30"
                          type="number"
                          value={type.weight}
                          onChange={v => updType(type.id, "weight", v)}
                        />
                      </div>
                    )}
                    {draftUsesWeights && draft.assessmentTypes.length > 1 && (
                      <button onClick={() => delType(type.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors mb-0.5">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="bg-muted/40 border border-foreground/5 rounded-xl p-4">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-2">Tracked Requirements</span>
                    
                    {type.columns.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic mb-3">No individual columns added yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {type.columns.map(c => (
                          <span key={c.id} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-bold pl-2.5 pr-1 py-1 rounded-full border border-primary/10">
                            {c.label}
                            <button onClick={() => delColFromDraft(type.id, c.id)} className="p-0.5 text-primary/60 hover:text-primary rounded-full hover:bg-primary/10">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="Add assessment (e.g., Quiz 1)"
                        value={newColLabel[type.id] || ""}
                        onChange={e => setNewColLabel(p => ({ ...p, [type.id]: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && addColToDraft(type.id)}
                        className="flex-1 bg-transparent border-0 border-b border-foreground/25 focus:border-primary text-xs pb-1 text-foreground focus:outline-none transition-colors placeholder:text-muted-foreground/50"
                      />
                      <button onClick={() => addColToDraft(type.id)} className="p-1.5 bg-primary text-white rounded-lg hover:bg-secondary shadow-sm transition-all">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {draftUsesWeights && (
                <button onClick={addType} className="w-full py-3 border-2 border-dashed border-white/30 text-white/80 hover:text-white hover:border-white/50 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all">
                  <Plus className="w-4 h-4" /> Add Weight Category
                </button>
              )}
            </div>
            {draft.gradingSystem === "base-custom" && (
              <div className="bg-card rounded-2xl p-5 text-foreground shadow-inner mb-6">
                <UInput
                  label="Base value"
                  placeholder="e.g., 50"
                  type="number"
                  value={draft.baseValue ?? ""}
                  onChange={v => setDraft(p => ({ ...p, baseValue: v }))}
                />
                {draftBaseError && (
                  <p className="text-xs text-red-600 mt-1">{draftBaseError}</p>
                )}
              </div>
            )}
            {draftUsesWeights && (
              <div className="mb-6">
                <div className="flex items-center justify-between text-xs text-white/70 font-semibold">
                  <span>Total weight</span>
                  <span className={draftWeightError ? "text-red-200" : "text-white"}>
                    {draftWeightTotal.toFixed(1)}%
                  </span>
                </div>
                {draftWeightError && (
                  <p className="text-xs text-red-200 mt-1">{draftWeightError}</p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setPage("c2")} className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white font-bold transition-colors">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => setPage("c4")}
                disabled={!canGoC4()}
                className="inline-flex items-center gap-1.5 bg-white text-primary px-5 py-2.5 rounded-2xl text-sm font-bold shadow-md hover:bg-white/90 disabled:opacity-40 transition-all"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </BluePanel>
        </div>
      )}

      {page === "c4" && (
        <div className="max-w-2xl mx-auto px-4 py-8">
          <BluePanel>
            <StepBar step={stepIdx} />
            <h2 className="text-2xl font-black text-white mb-1">Enter Raw Data</h2>
            <p className="text-white/60 text-xs mb-6">Input initial score frameworks or check empty values before finalization.</p>

            <div className="space-y-4 text-foreground mb-6 max-h-[50vh] overflow-y-auto pr-1">
              {draft.assessmentTypes.map(t => (
                <div key={t.id} className="bg-card rounded-2xl p-5 border border-foreground/5 shadow-md">
                  <div className="flex items-center justify-between border-b border-foreground/5 pb-2 mb-2">
                    <span className="font-black">{t.name || "Assessments"}</span>
                    {draftUsesWeights && (
                      <span className="text-xs font-bold text-muted-foreground">{t.weight}% Contribution</span>
                    )}
                  </div>
                  {t.columns.map(c => (
                    <ScoreRow
                      key={c.id}
                      col={c}
                      onScore={v => updDraftScore(t.id, c.id, "score", v)}
                      onTotal={v => updDraftScore(t.id, c.id, "total", v)}
                    />
                  ))}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <button onClick={() => setPage("c3")} className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white font-bold transition-colors">
                <ArrowLeft className="w-4 h-4" /> Edit Layout
              </button>
              <button
                onClick={saveSubject}
                disabled={!!draftConfigError}
                className="inline-flex items-center gap-1.5 bg-white text-primary px-6 py-3 rounded-2xl text-sm font-black shadow-md hover:bg-white/90 disabled:opacity-40 transition-all"
              >
                Save Tracked Subject <Check className="w-4 h-4" />
              </button>
            </div>
          </BluePanel>
        </div>
      )}

      {page === "subject" && activeSub && (
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="flex items-center justify-between mb-5">
            <button onClick={() => setPage("dashboard")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground font-semibold transition-colors">
              <ArrowLeft className="w-4 h-4" /> Back to Trackers
            </button>
            <button onClick={() => deleteSubject(activeSub.id)} className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100/30 font-bold px-3 py-1.5 rounded-xl transition-all">
              <Trash2 className="w-3.5 h-3.5" /> Remove Subject
            </button>
          </div>

          {(() => {
            const ready = isReady(activeSub)
            const result = ready ? computeResult(activeSub) : null
            const info = result && !result.error ? gradeInfo(result.grade, activeSub.gradingSystem) : null
            return (
              <>
                <BluePanel className="mb-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/20 uppercase tracking-wide">
                        {gsLabel(activeSub.gradingSystem, activeSub.baseValue)}
                      </span>
                      <h1 className="text-3xl font-black text-white mt-2 mb-1">{activeSub.name}</h1>
                    </div>
                      {result && !result.error && (
                        <div className="flex items-baseline gap-2 bg-white/10 px-6 py-4 rounded-3xl self-start sm:self-auto">
                          <span className="text-5xl font-black tracking-tight">{result.grade}</span>
                          <span className="text-sm font-semibold opacity-70">/100</span>
                          <span className="text-sm font-semibold opacity-70">
                            PUP {info?.pupEquivalent.toFixed(2)}
                          </span>
                        </div>
                      )}
                  </div>
                </BluePanel>

                <div className="space-y-4 text-foreground">
                  {activeSub.gradingSystem === "base-custom" && (
                    <div className="bg-card rounded-2xl p-5 text-foreground shadow-inner">
                      <UInput
                        label="Base value"
                        placeholder="e.g., 50"
                        type="number"
                        value={activeSub.baseValue ?? ""}
                        onChange={v => updSubjectBaseValue(activeSub.id, v)}
                      />
                      {activeBaseError && (
                        <p className="text-xs text-red-600 mt-1">{activeBaseError}</p>
                      )}
                    </div>
                  )}
                  {activeUsesWeights && (
                    <div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
                        <span>Total weight</span>
                        <span className={subjectEditError || activeWeightWarning ? "text-red-600" : "text-foreground/70"}>
                          {activeWeightTotal.toFixed(1)}%
                        </span>
                      </div>
                      {(subjectEditError || activeWeightWarning) && (
                        <p className="text-xs text-red-600 mt-1">{subjectEditError ?? activeWeightWarning}</p>
                      )}
                    </div>
                  )}

                  {activeSub.assessmentTypes.map(t => (
                    <div key={t.id} className="bg-card rounded-2xl p-6 border border-foreground/5 shadow-md">
                      <div className="flex gap-3 mb-4 items-end">
                        <div className="flex-1">
                          <UInput
                            label="Category Name"
                            placeholder="e.g., Quizzes, Midterms"
                            value={t.name}
                            onChange={v => updSubjectType(activeSub.id, t.id, "name", v)}
                          />
                        </div>
                        {activeUsesWeights && (
                          <div className="w-24">
                            <UInput
                              label="Weight (%)"
                              placeholder="e.g., 30"
                              type="number"
                              value={t.weight}
                              onChange={v => updSubjectWeight(activeSub.id, t.id, v)}
                            />
                          </div>
                        )}
                        {activeUsesWeights && activeSub.assessmentTypes.length > 1 && (
                          <button onClick={() => delTypeFromSubject(activeSub.id, t.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors mb-0.5">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="space-y-1">
                        {t.columns.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic mb-2">No assessments added yet.</p>
                        ) : (
                          t.columns.map(c => (
                            <ScoreRow
                              key={c.id}
                              col={c}
                              onScore={v => updScore(activeSub.id, t.id, c.id, "score", v)}
                              onTotal={v => updScore(activeSub.id, t.id, c.id, "total", v)}
                              onDelete={() => delColFromSubject(activeSub.id, t.id, c.id)}
                            />
                          ))
                        )}
                      </div>

                      <div className="flex gap-2 items-center mt-3">
                        <input
                          type="text"
                          placeholder="Add assessment (e.g., Quiz 1)"
                          value={newSubjectColLabel[t.id] || ""}
                          onChange={e => setNewSubjectColLabel(p => ({ ...p, [t.id]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && addColToSubject(activeSub.id, t.id)}
                          className="flex-1 bg-transparent border-0 border-b border-foreground/25 focus:border-primary text-xs pb-1 text-foreground focus:outline-none transition-colors placeholder:text-muted-foreground/50"
                        />
                        <button onClick={() => addColToSubject(activeSub.id, t.id)} className="p-1.5 bg-primary text-white rounded-lg hover:bg-secondary shadow-sm transition-all">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}

                  {activeUsesWeights && (
                    <button onClick={() => addTypeToSubject(activeSub.id)} className="w-full py-3 border-2 border-dashed border-foreground/10 text-foreground/70 hover:text-foreground hover:border-foreground/20 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all">
                      <Plus className="w-4 h-4" /> Add Weight Category
                    </button>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}
