export type DigitalTwinMethodScore = {
  key: string;
  label: string;
  kind: "dataset-testing" | "published-baseline";
  accuracy: number | null;
  exactMatch: number | null;
  comparedAnswers: number;
  participants: number;
  tasks: number;
};

export type DigitalTwinTaskScore = {
  taskKey: string;
  taskLabel: string;
  methods: Record<
    string,
    {
      accuracy: number | null;
      exactMatch: number | null;
      comparedAnswers: number;
    }
  >;
};

export type DigitalTwinEvaluationView = {
  key: "wave4" | "wave1_3";
  label: string;
  description: string;
  groundTruth: "wave4" | "wave1_3";
  heldOutAnswers: number;
  methods: DigitalTwinMethodScore[];
  tasks: DigitalTwinTaskScore[];
};

export type DigitalTwinStage4Report = {
  selectionId: string;
  selectedParticipants: number;
  evaluations: DigitalTwinEvaluationView[];
  baseline: {
    available: boolean;
    sourceUrl: string;
    revision: string;
    error: string | null;
  };
};
