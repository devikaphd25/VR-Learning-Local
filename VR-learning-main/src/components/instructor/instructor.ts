/**
 * Connects the instructor's legacy HTML table to live Socket.IO student data.
 * The immersive instructor menu uses its own UIKit rendering path.
 */
import { renderStudentTable } from "./student-table";
import { socket } from "../../network/socket";

socket.on("studentList", (students) => {
  renderStudentTable(students);
});
