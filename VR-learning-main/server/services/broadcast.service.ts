/**
 * Small Socket.IO broadcasting helper.
 * Goal: publish the current in-memory student list to every connected client.
 * Data source: server/state/store.ts through student.service.ts.
 */
import { getStudentList } from "./student.service.js";
import type { Server } from "socket.io";

export function broadcastStudentList(io: Server): void {
  io.emit("studentList", getStudentList());
}
