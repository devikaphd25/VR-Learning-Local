/**
 * Browser-side Supabase classroom API.
 * Goal: call SQL RPC functions for rooms, participants, questions, responses,
 * scores, and subscriptions. Converts database failures into
 * ClassroomSessionError messages consumed by login/classroom UI.
 */
import { ClassroomSessionError } from "../errors/classroom-session.errors";
import { supabase } from "./supabase-client.services";


export type QuestionState = "idle" | "open" | "revealed";

export type QuizQuestion = {
    question_id: string;
    ordinal: number;
    prompt: string;
    choices: string[];
};

export type CurrentQuestion = {
    question_id: string;
    prompt: string;
    choices: string[];
    question_state: QuestionState;
    slide_number: number;
};

export type AnswerResult = { is_correct: boolean; already_answered: boolean };

export type QuestionResult = {
    choice_index: number;
    votes: number;
    correct_index: number | null;
    total_answered: number;
};

export type RoomScore = {
    participant_id: string;
    device_id: string | null;
    display_name: string | null;
    answered: number;
    correct: number;
    avg_response_ms: number | null;
};

type ClassroomCreateSessionType = { room_id: string };
export type ClassroomJoinSessionType = {
    room_id: string;
    participant_id: string;
    current_slide: number;
    display_name: string;
    seat: string;
};


const NO_ACTIVE_ROOM = "NO_ACTIVE_ROOM";

const ERROR_MAP: Record<string, string> = {
    INVALID_PIN: "Invalid Pin",
    INVALID_CODE: "The classroom code must contain exactly 6 numbers.",
    ROOM_FULL: "This classroom has no available seats.",
    INVALID_SLIDE: "Invalid slide number",
}

function mapRpcError(error: { message: string }, fallback: string): never {
    const key = Object.keys(ERROR_MAP).find(k => error.message.includes(k));
    throw new ClassroomSessionError(key ? ERROR_MAP[key] : fallback, error);
}


export const ClassroomSessionService = {
    async create(): Promise<ClassroomCreateSessionType> {

        const { data, error } = await supabase.rpc("create_room");

        if (error) mapRpcError(error, "Could not create classroom session. Please try again")

        const row = data?.[0] as ClassroomCreateSessionType | undefined;

        if (!row) throw new ClassroomSessionError("Could not create room.")
        return { room_id: row.room_id }
    },

    async joinLatest(deviceId: string, name?: string): Promise<ClassroomJoinSessionType | null> {
        const { data, error } = await supabase.rpc("join_latest_active_room", {
            input_device_id: deviceId,
            input_name: name ?? null,
        });

        if (error) {
            if (error.message.includes(NO_ACTIVE_ROOM)) return null;
            mapRpcError(error, "Could not join the class. Please try again.");
        }

        const row = data?.[0] as ClassroomJoinSessionType | undefined;
        if (!row) return null;
        return {
            room_id: row.room_id,
            participant_id: row.participant_id,
            current_slide: row.current_slide,
            display_name: row.display_name,
            seat: row.seat,
        };
    },

    async close(room_id: string): Promise<void> {
        const { error } = await supabase.rpc("close_room", {
            input_room_id: room_id,
        });
        if (error) mapRpcError(error, "Could not end the class. Please try again.");
    },

    // ---------------------QUIZ-----------------------------------------------------
    async getSlideQuestions(deck: string, slide: number): Promise<QuizQuestion[]> {
        const { data, error } = await supabase.rpc("get_slide_questions", {
            input_deck: deck,
            input_slide: slide,
        });
        if (error) mapRpcError(error, "Could not load questions for this slide.");
        return (data ?? []) as QuizQuestion[];
    },

    async askQuestion(room_id: string, question_id: string): Promise<void> {
        const { error } = await supabase.rpc("ask_question", {
            input_room_id: room_id,
            input_question_id: question_id,
        });
        if (error) mapRpcError(error, "Could not open the quiz.");
    },

    async revealQuestion(room_id: string): Promise<void> {
        const { error } = await supabase.rpc("reveal_question", {
            input_room_id: room_id,
        });
        if (error) mapRpcError(error, "Could not reveal the answers.");
    },

    /** The open question as a student is allowed to see it — no correct_index. */
    async getCurrentQuestion(room_id: string): Promise<CurrentQuestion | null> {
        const { data, error } = await supabase.rpc("get_current_question", {
            input_room_id: room_id,
        });
        if (error) mapRpcError(error, "Could not load the question.");
        return (data?.[0] as CurrentQuestion | undefined) ?? null;
    },

    /** Graded server-side. A second call returns the original verdict unchanged. */
    async submitAnswer(participant_id: string, choice_index: number): Promise<AnswerResult> {
        const { data, error } = await supabase.rpc("submit_answer", {
            input_participant_id: participant_id,
            input_choice_index: choice_index,
        });
        if (error) mapRpcError(error, "Could not submit your answer.");

        const row = data?.[0] as AnswerResult | undefined;
        if (!row) throw new ClassroomSessionError("Could not submit your answer.");
        return row;
    },

    /** Vote tally. `correct_index` is null until the professor reveals. */
    async getQuestionResults(room_id: string): Promise<QuestionResult[]> {
        const { data, error } = await supabase.rpc("get_question_results", {
            input_room_id: room_id,
        });
        if (error) mapRpcError(error, "Could not load the results.");
        return (data ?? []) as QuestionResult[];
    },

    async getRoomScores(room_id: string): Promise<RoomScore[]> {
        const { data, error } = await supabase.rpc("get_room_scores", {
            input_room_id: room_id,
        });
        if (error) mapRpcError(error, "Could not load the scores.");
        return (data ?? []) as RoomScore[];
    },


    subscribe(room_id: string, onChange: (payload: unknown) => void, key = "default") {
        const channel = supabase.channel(`classroom-${room_id}-${key}`)
            .on("postgres_changes",
                { event: "*", schema: "public", table: "participants", filter: `room_id=eq.${room_id}` }, onChange)
            .on("postgres_changes",
                { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room_id}` },
                onChange)
            .subscribe()

        return () => supabase.removeChannel(channel)
    }
}
