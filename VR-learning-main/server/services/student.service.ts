/**
 * Read helpers for live classroom students.
 * Goal: keep lookup/list operations separate from socket event handlers.
 * Data source: the in-memory `students` map in server/state/store.ts.
 */
import { students } from "../state/store.js";
import type { ClassroomStudent } from "../types.js";

export function getStudentList(): ClassroomStudent[] {
  return Object.values(students);
}

export function findStudent(studentId: string): ClassroomStudent | null {
  return students[studentId] || null;
}
