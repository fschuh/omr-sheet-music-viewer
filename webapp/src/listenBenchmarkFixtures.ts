export interface ScoreBenchmarkMoment {
  measure: number;
  moment: number;
  pitches: readonly number[];
}

/**
 * Every pitched playback moment extracted from "Super Mario Bros - Course Clear"
 * in pdf-cache/13b74407b0870ee53fd027779fab7caf531663830cc6fa9528c733f8c59d99c0.
 * The fixture is kept in the repository so the benchmark does not depend on a
 * developer's cache directory.
 */
export const COURSE_CLEAR_BENCHMARK_MOMENTS: readonly ScoreBenchmarkMoment[] = [
  { measure: 1, moment: 1, pitches: [55] },
  { measure: 1, moment: 2, pitches: [52, 60] },
  { measure: 1, moment: 3, pitches: [55, 64] },
  { measure: 1, moment: 4, pitches: [48, 60, 67] },
  { measure: 1, moment: 5, pitches: [52, 64, 72] },
  { measure: 1, moment: 6, pitches: [55, 67, 76] },
  { measure: 1, moment: 7, pitches: [64, 72, 79] },
  { measure: 1, moment: 8, pitches: [60, 67, 76] },
  { measure: 2, moment: 1, pitches: [56] },
  { measure: 2, moment: 2, pitches: [51, 60] },
  { measure: 2, moment: 3, pitches: [56, 63] },
  { measure: 2, moment: 4, pitches: [48, 60, 68] },
  { measure: 2, moment: 5, pitches: [51, 63, 72] },
  { measure: 2, moment: 6, pitches: [56, 68, 75] },
  { measure: 2, moment: 7, pitches: [63, 72, 80] },
  { measure: 2, moment: 8, pitches: [60, 68, 75] },
  { measure: 3, moment: 1, pitches: [58] },
  { measure: 3, moment: 2, pitches: [53, 62] },
  { measure: 3, moment: 3, pitches: [58, 65] },
  { measure: 3, moment: 4, pitches: [50, 62, 70] },
  { measure: 3, moment: 5, pitches: [53, 65, 74] },
  { measure: 3, moment: 6, pitches: [58, 70, 77] },
  { measure: 3, moment: 7, pitches: [65, 74, 82] },
  { measure: 3, moment: 8, pitches: [62, 74, 82] },
  { measure: 3, moment: 9, pitches: [62, 74, 82] },
  { measure: 3, moment: 10, pitches: [62, 74, 82] },
  { measure: 4, moment: 1, pitches: [60, 76, 84] },
];
