/** Renders live students into the optional browser-based instructor table. */
import { socket } from "../../network/socket";

// ✅ Add Window interface declaration
declare global {
    interface Window {
        toggleStudentHand: (studentId: string) => void;
        toggleStudentMute: (studentId: string) => void;
        changeStudentRoom: (studentId: string, room: string) => void;
        socket: any;
    }
}

interface Student {
    id: string;
    name: string;
    seat: string;
    mode: string;
    isDemo: boolean;
    handRaised: boolean;
    isMuted?: boolean;
    room?: string;
    isPresent?: boolean;
}

const rooms = ['Main Room', 'Room A', 'Room B', 'Room C', 'Room D'];

export function renderStudentTable(students: Student[]) {
    const tbody = document.querySelector("#studentTableBody");
    if (!tbody) return;

    const sortedStudents = [...students].sort((a, b) => {
        if (a.isDemo && !b.isDemo) return -1;
        if (!a.isDemo && b.isDemo) return 1;
        return a.seat.localeCompare(b.seat);
    });

    if (sortedStudents.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <div class="emoji">👀</div>
                        <h3>No students online</h3>
                        <p>Waiting for students to join the classroom...</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = sortedStudents.map((student: Student) => {
        const isHandRaised = student.handRaised || false;
        const isMuted = student.isMuted || false;
        const currentRoom = student.room || 'Main Room';
        const isPresent = student.isPresent !== false;
        const modeClass = student.mode === 'Presentation Mode' ? 'presentation' : 'classroom';
        
        return `
            <tr data-student-id="${student.id}">
                <td>
                    <span class="seat-name">${student.seat}</span>
                </td>
                <td>
                    <span class="student-id">${student.id.substring(0, 6)}</span>
                    ${student.isDemo ? ' <span style="font-size:10px;color:#64748b;">(demo)</span>' : ''}
                </td>
                <td>
                    <span class="mode-badge ${modeClass}">
                        ${student.mode}
                    </span>
                </td>
                <td>
                    <div class="status-clickable" onclick="window.toggleStudentHand('${student.id}')">
                        ${isHandRaised ? `
                            <span style="color:#fbbf24;font-size:14px;font-weight:500;">✋ Hand Raised</span>
                        ` : `
                            <span style="color:#22c55e;font-size:14px;font-weight:500;">🟢 Online</span>
                        `}
                    </div>
                </td>
                <td>
                    <select class="room-select" 
                            data-student-id="${student.id}"
                            onchange="window.changeStudentRoom('${student.id}', this.value)"
                            style="
                                background: rgba(255,255,255,0.06);
                                border: 1px solid rgba(255,255,255,0.08);
                                border-radius: 6px;
                                padding: 4px 8px;
                                color: #e8eaed;
                                font-size: 12px;
                                outline: none;
                                cursor: pointer;
                                transition: all 0.3s;
                                min-width: 100px;
                            "
                            onfocus="this.style.borderColor='#60a5fa'"
                            onblur="this.style.borderColor='rgba(255,255,255,0.08)'"
                    >
                        ${rooms.map((room: string) => `
                            <option value="${room}" ${room === currentRoom ? 'selected' : ''}>
                                ${room}
                            </option>
                        `).join('')}
                    </select>
                </td>
                <td>
                    <span class="attendance-badge ${isPresent ? 'present' : 'absent'}">
                        ${isPresent ? '✅ Present' : '❌ Absent'}
                    </span>
                </td>
                <td>
                    <div class="mute-toggle">
                        <span class="icon" style="color:${isMuted ? '#ef4444' : '#22c55e'};">
                            ${isMuted ? '🔇' : '🔊'}
                        </span>
                        <button 
                            class="toggle-switch ${isMuted ? 'off' : 'on'}"
                            onclick="event.stopPropagation(); window.toggleStudentMute('${student.id}')"
                            title="${isMuted ? 'Click to unmute' : 'Click to mute'}"
                        >
                            <div class="slider"></div>
                        </button>
                        <span class="toggle-label ${isMuted ? 'off' : 'on'}">
                            ${isMuted ? 'Off' : 'On'}
                        </span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Update stats
    const studentCountElement = document.getElementById("studentCount");
    const raisedCountElement = document.getElementById("raisedCount");
    const presentCountElement = document.getElementById("presentCount");
    const absentCountElement = document.getElementById("absentCount");
    
    if (studentCountElement) {
        studentCountElement.textContent = String(sortedStudents.length);
    }
    
    if (raisedCountElement) {
        const raisedCount = sortedStudents.filter((s: Student) => s.handRaised).length;
        raisedCountElement.textContent = String(raisedCount);
    }

    if (presentCountElement) {
        const presentCount = sortedStudents.filter((s: Student) => s.isPresent !== false).length;
        presentCountElement.textContent = String(presentCount);
    }

    if (absentCountElement) {
        const absentCount = sortedStudents.filter((s: Student) => s.isPresent === false).length;
        absentCountElement.textContent = String(absentCount);
    }
}

// ✅ Toggle hand - with proper typing
window.toggleStudentHand = (studentId: string): void => {
    socket.emit('instructorToggleHand', { studentId });
};

// ✅ Toggle mute - with proper typing
window.toggleStudentMute = (studentId: string): void => {
    socket.emit('instructorToggleMute', { studentId });
};

// ✅ Change room - with proper typing
window.changeStudentRoom = (studentId: string, room: string): void => {
    socket.emit('changeStudentRoom', { studentId, room });
};

// Listen for events
socket.on('handToggled', () => {
    socket.emit('requestStudentList');
});

socket.on('muteUpdated', () => {
    socket.emit('requestStudentList');
});

socket.on('roomChanged', () => {
    socket.emit('requestStudentList');
});

socket.on('raiseHandUpdated', () => {
    socket.emit('requestStudentList');
});

socket.on('attendanceUpdated', () => {
    socket.emit('requestStudentList');
});
