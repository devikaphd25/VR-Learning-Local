/** Canonical seat identifiers and small seat lookup helpers shared by classroom systems. */
const Seats = [
    'Seat_R0_00',
    'Seat_R1_01', 'Seat_R1_02', 'Seat_R1_03', 'Seat_R1_04', 'Seat_R1_05',
    'Seat_R2_01', 'Seat_R2_02', 'Seat_R2_03', 'Seat_R2_04', 'Seat_R2_05',
    'Seat_R3_01', 'Seat_R3_02', 'Seat_R3_03', 'Seat_R3_04', 'Seat_R3_05',
    'Seat_R4_01', 'Seat_R4_02', 'Seat_R4_03', 'Seat_R4_04', 'Seat_R4_05',
    'Seat_R5_01', 'Seat_R5_02', 'Seat_R5_03', 'Seat_R5_04', 'Seat_R5_05',
] as const;

export type SeatType = (typeof Seats)[number];
export const SeatType = Object.fromEntries(
    Seats.map(s => [s,s]),
) as Record<SeatType, SeatType>;
