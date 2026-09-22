/**
 * Shared transient server state.
 *
 * Goal: hold currently connected students, users moving between classroom and
 * lab, and live LabSession instances. This state resets with the Node server;
 * permanent identities and results belong in Supabase.
 */
// ========================================================
// SHARED SERVER STATE
// ========================================================

/*
 * Classroom students are currently indexed by their
 * classroom Socket.IO socket ID.
 *
 * We will improve this later, but for now we keep the
 * existing structure so nothing else breaks.
 */
import type {
  ClassroomStudent,
  ConnectedUser,
  ReturningStudent
} from "../types.js";
import type { LabSession } from "./LabSession.js";

export const students: Record<string, ClassroomStudent> = {};

/*
 * Lab sessions are indexed by permanent database user ID.
 */
export const labSessions: Record<string, LabSession> = {};

/*
 * Stores students who are moving from the lab back to
 * the classroom.
 */
export const returningStudents: Record<string, ReturningStudent> = {};

/*
 * Cross-application connection records.
 *
 * This is indexed by the permanent SQLite user ID.
 *
 * Example:
 *
 * connectedUsers[12] = {
 *   userId: 12,
 *   username: "Tina",
 *   classroomSocketId: null,
 *   labSocketId: "abc123",
 *   location: "python_lab"
 * };
 */
export const connectedUsers: Record<string, ConnectedUser> = {};
