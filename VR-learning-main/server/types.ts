/**
 * Shared server data contracts.
 *
 * Goal: describe users, rooms, sockets, challenges, lab progress, and saved
 * results so server modules exchange predictable objects. These declarations
 * do not execute logic or store records; Supabase and the in-memory store do.
 * Used by: server.ts, repositories, services, socket handlers, and LabSession.
 */
import type { Socket } from "socket.io";

export type UserRole = "instructor" | "student";
export type UserLocation = "classroom" | "python_lab";
export type LabStatus = "working" | "completed" | "incomplete" | "instructor_return" | "disconnected";

export interface AppUserRow {
  id: number | string;
  username: string;
  password_hash: string | null;
  full_name: string;
  role: UserRole;
  seat: string | null;
  location: UserLocation;
  device_id: string | null;
}

export interface AppUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  seat: string | null;
  location: UserLocation;
  deviceId: string | null;
  passwordHash: string | null;
}

export interface ClassroomStudent {
  id?: string;
  userId?: number;
  name: string;
  username?: string;
  role?: UserRole;
  seat?: string | null;
  roomId?: string | null;
  participantId?: string | null;
  mode?: string;
  location?: string;
  handRaised?: boolean;
  isMuted?: boolean;
  inLab?: boolean;
  labStatus?: string;
  score?: number;
  [key: string]: any;
}

export interface ConnectedUser {
  userId: number;
  username: string;
  classroomSocketId: string | null;
  labSocketId: string | null;
  location: UserLocation;
  [key: string]: any;
}

export interface ReturningStudent {
  userId?: number;
  username?: string;
  seat?: string | null;
  returnReason?: string | null;
  [key: string]: any;
}

export interface RoomRecord {
  id: string;
  code?: string | null;
  is_active: boolean;
  current_slide?: number;
  created_at?: string;
  closed_at?: string | null;
}

export interface QuickChallengeQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
}

export interface QuickChallengeStudentProgress {
  answers: Array<{
    questionIndex: number;
    selectedIndex: number;
    correct: boolean;
    answeredAt: number;
  }>;
  completed: boolean;
  finishedAt?: number;
  totalTimeSeconds?: number;
}

export interface QuickChallenge {
  id: string;
  roomId: string;
  question: string;
  options: string[];
  correctIndex: number;
  durationSeconds: number;
  startedAt: number;
  cycleLabel?: string;
  challengeType?: string;
  questionIndex?: number;
  totalQuestions?: number;
  questions?: QuickChallengeQuestion[];
  answers: Map<string, {
    selectedIndex: number;
    correct: boolean;
    answeredAt: number;
    responseTimeSeconds: number;
  }>;
  studentProgress: Map<string, QuickChallengeStudentProgress>;
  timeout: NodeJS.Timeout | null;
}

export interface QuickChallengeReview {
  quizId: string;
  cycleLabel: string;
  question: string;
  options: string[];
  correctIndex: number;
  answerCounts: number[];
  studentCount: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  elapsedSeconds: number;
}

export type Challenge2Category = "input" | "output" | "both" | "storage";

export interface Challenge2StudentProgress {
  completedItemIds: Set<string>;
  attempts: number;
  wrongAttempts: number;
  wrongSelections: Map<string, Map<Challenge2Category, number>>;
  startedAt: number;
  completedAt: number | null;
}

export interface Challenge2Session {
  id: string;
  roomId: string;
  durationSeconds: number;
  startedAt: number;
  progress: Map<string, Challenge2StudentProgress>;
  timeout: NodeJS.Timeout | null;
}

export type ClassroomSocket = Socket & {
  isGameClient?: boolean;
  studentId?: number;
  studentName?: string;
  seat?: string | null;
  data: Socket["data"] & {
    userId?: number;
    role?: UserRole;
    roomId?: string;
    participantId?: string;
    clientType?: "classroom" | "lab";
  };
};

export interface LabMistake {
  studentName: string;
  seat: string | null;
  cardId: string;
  question: string;
  selectedType: string;
  correctType: string;
  attempt: number;
  occurredAt: string;
}

export interface LabExerciseUpdate {
  score?: number;
  streak?: number;
  wpm?: number;
  accuracy?: number;
}

export interface GameResultInput {
  userId: number;
  gameName?: string;
  score?: number;
  durationSeconds?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  completedExercises?: number;
  totalExercises?: number;
  accuracy?: number;
  status: Exclude<LabStatus, "working">;
}

export interface DeviceUserInput {
  deviceId: string;
  displayName: string;
  role: UserRole;
  seat: string | null;
}
