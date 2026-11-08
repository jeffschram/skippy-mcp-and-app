"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../lib/skippy-api";
import { Button, Select, TextInput } from "../components";
import { describeRule } from "./recurrences-helpers";
import { useItemAction } from "./home-item-actions";

type Detail = NonNullable<FunctionReturnType<typeof api.homeInventory.getForViewer>>;
export function dateInput(at: number | null) {
  if (at === null) return "";
  const date = new Date(at);
  return new Date(at - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function TaskEditor({ detail }: { detail: Detail }) {
  const { row } = detail;
  const { pending, run } = useItemAction(row);
  const update = useMutation(api.lifeTasks.updateLifeTask);
  const waiting = useMutation(api.waiting.setWaitingOn);
  const move = useMutation(api.projects.moveTaskToProjectForViewer);
  const projects = useQuery(api.projects.activeProjectsForViewer, {});
  const contacts = useQuery(api.knowledge.contactsForViewer, {});
  const [title, setTitle] = useState(row.title);
  const [description, setDescription] = useState(detail.description ?? "");
  const [due, setDue] = useState(dateInput(row.at));
  const [person, setPerson] = useState("");
  const [project, setProject] = useState("");
  return <div className="grid gap-4">
    <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void run(() => update({
      taskId: row.id as any, expectedUpdatedAt: detail.updatedAt,
      ...(row.occurrenceVersion !== null ? { expectedOccurrenceVersion: row.occurrenceVersion } : {}),
      title, description, ...(due !== dateInput(row.at) ? { dueAt: due ? new Date(due).getTime() : null } : {}),
    })); }}>
      <label className="grid gap-1">Title<TextInput required value={title} onChange={event => setTitle(event.target.value)} disabled={pending} /></label>
      <label className="grid gap-1">Description<textarea className="min-h-24 rounded border border-border p-2" value={description} onChange={event => setDescription(event.target.value)} disabled={pending} /></label>
      {!row.isWant ? <label className="grid gap-1">Deadline (your local time)<TextInput type="datetime-local" required={!!row.recurrenceId} value={due} onChange={event => setDue(event.target.value)} disabled={pending} /></label> : <p>Wants have no deadline.</p>}
      {row.recurrenceId ? <p className="text-sm">This deadline also sets the repeat’s next occurrence. Scheduled occurrences cannot have an empty deadline.</p> : !row.isWant && due ? <Button type="button" disabled={pending} onClick={() => setDue("")}>Clear deadline</Button> : null}
      <Button type="submit" disabled={pending || !title.trim()}>Save task</Button>
    </form>
    <div className="grid gap-2">
      <label className="grid gap-1">Waiting on<Select value={person} disabled={pending} onChange={event => setPerson(event.target.value)}>
        <option value="">Choose a person</option>
        {contacts?.people.map((person: any) => <option key={person._id} value={person._id}>{person.name}</option>)}
      </Select></label>
      {contacts && !contacts.people.length ? <p className="text-sm">Add a person in Brain → Contacts to mark this task waiting.</p> : null}
      {detail.waitingOn ? <p className="text-sm">Currently waiting on {contacts?.people.find((p: any) => p._id === detail.waitingOn?.entityId)?.name ?? "a linked item"}.</p> : null}
      <div className="flex gap-2"><Button disabled={pending || !person} onClick={() => void run(() => waiting({ taskId: row.id as any, expectedUpdatedAt: detail.updatedAt, waitingOn: { entityType: "person", entityId: person } }))}>Mark waiting</Button>
        {row.isWaiting || detail.waitingOn ? <Button disabled={pending} onClick={() => void run(() => waiting({ taskId: row.id as any, expectedUpdatedAt: detail.updatedAt, waitingOn: null }))}>Clear waiting</Button> : null}</div>
    </div>
    <div className="grid gap-2">
      <label className="grid gap-1">Existing project<Select disabled={pending} value={project} onChange={event => setProject(event.target.value)}>
        <option value="">Choose a project</option>{projects?.map((project: any) => <option key={project._id} value={project._id}>{project.title}</option>)}
      </Select></label>
      <p className="text-sm">Linking moves this task out of all personal Home sections into the project. Its identity and details link stay the same.{row.recurrenceId ? " Future repeat occurrences remain personal." : ""}</p>
      {projects && !projects.length ? <p className="text-sm">Create a project in Projects first.</p> : null}
      <Button disabled={pending || !project || project === detail.projectId} onClick={() => void run(() => move({ taskId: row.id as any, toProjectId: project as any, expectedUpdatedAt: detail.updatedAt }), "Linked to project. Removed from personal Home sections.")}>Link to project</Button>
    </div>
  </div>;
}
export function ScheduleEditor({ detail }: { detail: Detail }) {
  const { row, schedule } = detail;
  const { pending, run } = useItemAction(row);
  const patch = useMutation(api.recurrences.patchScheduleForViewer);
  const [cadence, setCadence] = useState("keep");
  const [amount, setAmount] = useState("1");
  const [weekday, setWeekday] = useState("MO");
  const [monthDay, setMonthDay] = useState("1");
  const [month, setMonth] = useState("1");
  const [anchor, setAnchor] = useState(schedule?.anchor ?? "completion");
  const [zone, setZone] = useState(detail.timeZone ?? "UTC");
  const [due, setDue] = useState(dateInput(schedule?.nextDueAt ?? null));
  if (!schedule || !row.recurrenceId) return null;
  return <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void run(() => patch({
    recurrenceId: row.recurrenceId as any, expectedOccurrenceVersion: row.occurrenceVersion ?? 0,
    ...(cadence === "keep" ? {} : { rule: cadence === "interval" ? { kind: "interval" as const, everyDays: Number(amount) } : {
      kind: "calendar" as const, rrule: `FREQ=${cadence};INTERVAL=${Number(amount)};${cadence === "WEEKLY" ? `BYDAY=${weekday}` : `${cadence === "YEARLY" ? `BYMONTH=${Number(month)};` : ""}BYMONTHDAY=${Number(monthDay)}`}`,
    } }),
    anchor, timeZone: zone,
    ...(due !== dateInput(schedule.nextDueAt) ? { nextDueAt: new Date(due).getTime() } : {}),
  })); }}>
    <h4 className="font-semibold">Repeat schedule</h4>
    <label className="grid gap-1">Cadence<Select value={cadence} disabled={pending} onChange={event => { setCadence(event.target.value); setAmount("1"); }}>
      <option value="keep">Keep current: {describeRule(schedule.rule)}</option><option value="interval">Every N days</option>
      <option value="WEEKLY">Weekly on a weekday</option><option value="MONTHLY">Monthly on a date</option><option value="YEARLY">Yearly on a date</option>
    </Select></label>
    {cadence !== "keep" ? <label className="grid gap-1">Every ({cadence === "interval" ? "days" : cadence === "WEEKLY" ? "weeks" : cadence === "MONTHLY" ? "months" : "years"})<TextInput type="number" min="1" max="36500" step="1" required disabled={pending} value={amount} onChange={event => setAmount(event.target.value)} /></label> : null}
    {cadence === "WEEKLY" ? <label className="grid gap-1">Weekday<Select disabled={pending} value={weekday} onChange={event => setWeekday(event.target.value)}>
      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={["SU", "MO", "TU", "WE", "TH", "FR", "SA"][index]}>{day}</option>)}
    </Select></label> : null}
    {cadence === "YEARLY" ? <label className="grid gap-1">Month<Select disabled={pending} value={month} onChange={event => setMonth(event.target.value)}>
      {Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{new Date(2000, index, 1).toLocaleString(undefined, { month: "long" })}</option>)}
    </Select></label> : null}
    {cadence === "MONTHLY" || cadence === "YEARLY" ? <label className="grid gap-1">Day of month<TextInput type="number" min="1" max="31" step="1" required disabled={pending} value={monthDay} onChange={event => setMonthDay(event.target.value)} /></label> : null}
    <label className="grid gap-1">Count from<Select disabled={pending} value={anchor} onChange={event => setAnchor(event.target.value as typeof anchor)}><option value="completion">Actual completion</option><option value="schedule">Scheduled date</option></Select></label>
    <label className="grid gap-1">Schedule time zone<TextInput required disabled={pending} value={zone} onChange={event => setZone(event.target.value)} /></label>
    <label className="grid gap-1">Next due (your local time)<TextInput type="datetime-local" required disabled={pending} value={due} onChange={event => setDue(event.target.value)} /></label>
    <p className="text-sm">Changing next due overrides this occurrence only. Later occurrences follow the cadence. Skipping advances the schedule without recording a completion; pausing keeps the current task and date.</p>
    <Button type="submit" disabled={pending}>Save schedule</Button>
  </form>;
}
