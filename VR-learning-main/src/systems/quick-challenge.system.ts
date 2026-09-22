/**
 * Student Quick Challenge UI and interaction system.
 * Goal: receive the selected lesson question, collect one answer by mouse/ray,
 * submit it through Socket.IO, show correctness/time, and return on instructor
 * stop. The instructor monitor is handled by instructor-menu.system.ts.
 */
import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  RayInteractable,
  UIKit,
  type UIKitDocument,
} from "@iwsdk/core";
import { Matrix4, Raycaster, Vector2, Vector3 } from "three";

import { socket } from "../network/socket";

interface QuickChallengeQuestion {
  question: string;
  options: string[];
}

interface QuickChallengePayload {
  id: string;
  question: string;
  options: string[];
  durationSeconds: number;
  startedAt: number;
  challengeType?: string;
  totalQuestions?: number;
  questions?: QuickChallengeQuestion[];
}

interface QuickChallengeResult {
  quizId: string;
  correct?: boolean;
  correctIndex?: number;
  selectedIndex?: number | null;
  responseTimeSeconds?: number;
  message?: string;
  questionIndex?: number;
  hasNext?: boolean;
  nextQuestionIndex?: number | null;
  correctCount?: number;
  answeredCount?: number;
  totalQuestions?: number;
  completed?: boolean;
  results?: Array<{
    questionIndex: number;
    selectedIndex: number;
    correctIndex: number;
    correct: boolean;
  }>;
}

interface QuickChallengeEndedPayload {
  quizId?: string;
  winnerStudentId?: string | null;
  winnerName?: string | null;
  winnerTimeSeconds?: number | null;
  stoppedByInstructor?: boolean;
}

export class QuickChallengeSystem extends createSystem({
  panel: {
    required: [PanelUI, PanelDocument],
    where: [
      eq(
        PanelUI,
        "config",
        "./ui/quick-challenge.json"
      )
    ]
  }
}) {
  private document?: UIKitDocument;
  private challenge?: QuickChallengePayload;
  private questions: QuickChallengeQuestion[] = [];
  private questionIndex = 0;
  private selections: Array<number | null> = [];
  private reviewResults: Array<{
    selectedIndex: number;
    correctIndex: number;
    correct: boolean;
  }> | null = null;
  private correctCount = 0;
  private showingResult = false;
  private selectedIndex: number | null = null;
  private timer?: number;
  private submitted = false;
  private timeExpired = false;
  private buttonsConnected = false;
  private lastDesktopActivation = 0;
  private lastNavAt = 0;
  private responseTimeSeconds = 0;
  private disabledRayTargets: Array<{
    entity: any;
    wasVisible: boolean;
    pointerEvents: any;
    hadRayInteractable: boolean;
  }> = [];

  init(): void {
    this.queries.panel.subscribe(
      "qualify",
      entity => {
        this.connectPanelWhenReady(
          entity.index
        );
      }
    );

    socket.on("quickChallengeStarted", this.startChallenge);
    socket.on("quickChallengeResult", this.showResult);
    socket.on("quickChallengeEnded", this.endChallenge);

    // UIKit's spatial buttons are used by controller rays. Some desktop
    // browsers, however, do not forward canvas mouse events to a panel that
    // was constructed while hidden. This listener only supplies the missing
    // desktop hit test and is deliberately disabled during an XR session.
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handleDesktopPointer,
      true
    );
  }

  private handleDesktopPointer = (event: PointerEvent): void => {
    if (
      this.renderer.xr.isPresenting ||
      !(window as any).isQuickChallengeOpen ||
      event.button !== 0
    ) {
      return;
    }

    const panel = (window as any).quickChallengeEntity?.object3D;
    if (!panel?.visible) return;

    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(
      ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1,
      -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, this.camera);

    panel.updateMatrixWorld(true);
    const inversePanelMatrix = new Matrix4().copy(panel.matrixWorld).invert();
    const localRay = raycaster.ray.clone().applyMatrix4(inversePanelMatrix);
    if (Math.abs(localRay.direction.z) < 0.00001) return;

    const distance = -localRay.origin.z / localRay.direction.z;
    if (distance < 0) return;
    const localHit = localRay.at(distance, localRay.origin.clone());

    // PanelUI is configured with maxWidth 1.75 and maxHeight 1.35 in
    // index.ts. Converting the ray hit in panel-local space is stable even
    // when the browser is resized or the panel is camera-attached.
    const x = (localHit.x + 0.875) / 1.75;
    const y = (0.675 - localHit.y) / 1.35;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    let action: (() => void) | undefined;
    let actionName = "";

    if (this.isFivePartsChallenge()) {
      if (y >= 0.28 && y < 0.52) {
        const index = x < 0.5 ? 0 : 1;
        action = () => this.selectAnswer(index);
        actionName = `answer-${index}`;
      }
    } else if (this.showingResult) {
      if (y >= 0.70 && y <= 0.95) {
        action = this.closeResult;
        actionName = "close";
      }
    } else if (y >= 0.30 && y < 0.49) {
      const index = x < 0.5 ? 0 : 1;
      action = () => this.selectAnswer(index);
      actionName = `answer-${index}`;
    } else if (y >= 0.49 && y < 0.69) {
      const index = x < 0.5 ? 2 : 3;
      action = () => this.selectAnswer(index);
      actionName = `answer-${index}`;
    } else if (y >= 0.69 && y <= 0.94) {
      action = this.submitAnswer;
      actionName = "submit";
    }

    if (!action) return;

    const now = performance.now();
    if (now - this.lastDesktopActivation < 220) return;
    this.lastDesktopActivation = now;

    event.preventDefault();
    event.stopPropagation();
    action();
    console.log(`[Quick Challenge] Desktop mouse activated ${actionName}.`);
  };

  private connectPanelWhenReady(
    entityIndex: number,
    attempt = 0
  ): void {
    const document =
      PanelDocument.data.document[
        entityIndex
      ] as UIKitDocument | undefined;

    if (!document) {
      if (attempt < 180) {
        requestAnimationFrame(() => {
          this.connectPanelWhenReady(
            entityIndex,
            attempt + 1
          );
        });
      } else {
        console.error(
          "[Quick Challenge] Panel document did not become ready."
        );
      }
      return;
    }

    this.document = document;

    if (this.buttonsConnected) {
      return;
    }

    const requiredButtonIds = [
      "quiz-answer-0",
      "quiz-answer-1",
      "quiz-answer-2",
      "quiz-answer-3",
      "quiz-submit",
      "quiz-prev",
      "quiz-next",
      "quiz-result-close",
    ];
    const missingButton = requiredButtonIds.some(
      id => !this.document?.getElementById(id)
    );

    if (missingButton) {
      if (attempt < 180) {
        requestAnimationFrame(() => {
          this.connectPanelWhenReady(entityIndex, attempt + 1);
        });
      } else {
        console.error("[Quick Challenge] Interactive buttons did not become ready.");
      }
      return;
    }

    this.buttonsConnected = true;

    for (let index = 0; index < 4; index += 1) {
      this.bindSpatialButton(
        `quiz-answer-${index}`,
        () => this.selectAnswer(index)
      );
    }

    this.bindSpatialButton(
      "quiz-submit",
      this.submitAnswer
    );
    this.bindSpatialButton(
      "quiz-prev",
      this.goPrevious,
      ["pointerdown", "click"]
    );
    this.bindSpatialButton(
      "quiz-next",
      this.goNext,
      ["pointerdown", "click"]
    );
    this.bindSpatialButton(
      "quiz-result-close",
      this.closeResult
    );

    console.log(
      "[Quick Challenge] Mouse and spatial-ray buttons connected."
    );
  }

  private bindSpatialButton(
    elementId: string,
    handler: () => void,
    eventNames: Array<"pointerdown" | "click"> = ["pointerdown", "click"]
  ): void {
    const element =
      this.document?.getElementById(elementId);

    if (!element) {
      return;
    }

    let lastActivation = 0;
    const activate = (event?: any): void => {
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      const now = performance.now();

      if (now - lastActivation < 220) {
        return;
      }

      lastActivation = now;
      handler();
    };

    eventNames.forEach(eventName => {
      element.addEventListener(eventName, activate);
    });
  }

  private startChallenge = (
    payload: QuickChallengePayload
  ): void => {
    if (!payload || !Array.isArray(payload.options)) {
      return;
    }

    this.challenge = payload;
    this.questions =
      Array.isArray(payload.questions) && payload.questions.length > 0
        ? payload.questions
        : [{ question: payload.question, options: payload.options }];
    this.questionIndex = 0;
    this.selections = this.questions.map(() => null);
    this.reviewResults = null;
    this.correctCount = 0;
    this.selectedIndex = null;
    this.submitted = false;
    this.timeExpired = false;
    this.responseTimeSeconds = 0;
    this.renderCurrentView();
    this.setVisible(true);
    this.startTimer();
    this.sync();
  };

  private isFivePartsChallenge(): boolean {
    return this.challenge?.challengeType === "five-parts" && this.questions.length > 1;
  }

  private isSummaryView(): boolean {
    return (
      this.isFivePartsChallenge() &&
      Boolean(this.reviewResults) &&
      this.questionIndex >= this.questions.length
    );
  }

  private renderCurrentView(): void {
    if (this.isFivePartsChallenge() && this.isSummaryView()) {
      this.renderSummaryView();
      return;
    }
    this.renderCurrentQuestion();
  }

  private renderCurrentQuestion(): void {
    const payload = this.challenge;
    const current = this.questions[this.questionIndex];
    if (!payload || !current) return;

    this.selectedIndex = this.selections[this.questionIndex] ?? null;
    this.setResultMode(false);
    this.setText("quiz-question", current.question);
    this.updateProgressLabel();
    this.updateNavButtons();
    this.updateSubmitButton();

    for (let index = 0; index < 4; index += 1) {
      const option = current.options[index];
      const answer = this.document?.getElementById(`quiz-answer-${index}`);

      if (option === undefined) {
        this.addClass(answer, "answer-hidden");
        this.setText(`quiz-answer-${index}`, "");
      } else {
        this.removeClass(answer, "answer-hidden");
        const useLetterPrefix = current.options.length > 2;
        this.setText(
          `quiz-answer-${index}`,
          useLetterPrefix
            ? `${String.fromCharCode(65 + index)}. ${option}`
            : option
        );
      }
    }

    const secondAnswerRow = this.document?.getElementById(
      "quiz-answer-row-2"
    );
    if (current.options.length <= 2) {
      this.addClass(secondAnswerRow, "answer-hidden");
    } else {
      this.removeClass(secondAnswerRow, "answer-hidden");
    }

    this.setFeedback("");
    this.setText(
      "quiz-instruction",
      this.submitted && this.isFivePartsChallenge()
        ? ""
        : current.options.length <= 2
          ? "Select True or False"
          : "Select one answer"
    );
    this.updateSelection();
    this.sync();
  }

  private renderSummaryView(): void {
    const total = this.questions.length;
    this.setResultMode(true);
    this.updateProgressLabel();
    this.updateNavButtons();
    this.updateSubmitButton();
    this.setText("quiz-result-status", `SCORE ${this.correctCount}/${total}`);
    this.setText("quiz-result-answer", "");
    this.setText(
      "quiz-result-time",
      `Time taken: ${this.responseTimeSeconds.toFixed(1)} seconds`
    );
    this.setText("quiz-result-winner", "");
    this.setCloseButtonLabel("RETURN TO CLASS");
    const card = this.document?.getElementById("quiz-result-card");
    const status = this.document?.getElementById("quiz-result-status");
    this.removeClass(card, "quiz-result-correct", "quiz-result-wrong");
    this.removeClass(status, "quiz-result-correct", "quiz-result-wrong");
    this.addClass(card, "quiz-result-correct");
    this.addClass(status, "quiz-result-correct");
    this.sync();
  }

  private updateProgressLabel(): void {
    const total = this.questions.length;
    const progress = this.document?.getElementById("quiz-progress");
    const nav = this.document?.getElementById("quiz-nav");
    if (this.isFivePartsChallenge()) {
      this.removeClass(nav, "answer-hidden");
      this.removeClass(progress, "answer-hidden");
      this.setText(
        "quiz-progress",
        this.isSummaryView() ? "RESULTS" : `${this.questionIndex + 1} / ${total}`
      );
    } else {
      this.addClass(nav, "answer-hidden");
      this.addClass(progress, "answer-hidden");
      this.setText("quiz-progress", "");
    }
  }

  private allQuestionsAnswered(): boolean {
    return (
      this.selections.length === this.questions.length &&
      this.selections.every(selection => selection !== null)
    );
  }

  private updateSubmitButton(): void {
    const submit = this.document?.getElementById("quiz-submit");
    const actions = this.document?.getElementById("quiz-actions");
    if (this.isFivePartsChallenge() && this.submitted) {
      this.addClass(actions, "answer-hidden");
      return;
    }
    this.removeClass(actions, "answer-hidden");
    if (this.isFivePartsChallenge() && !this.allQuestionsAnswered()) {
      this.addClass(submit, "submit-disabled");
    } else {
      this.removeClass(submit, "submit-disabled");
    }
  }

  private updateNavButtons(): void {
    const prev = this.document?.getElementById("quiz-prev");
    const next = this.document?.getElementById("quiz-next");
    const maxIndex = this.reviewResults
      ? this.questions.length
      : Math.max(0, this.questions.length - 1);
    if (this.questionIndex <= 0) this.addClass(prev, "nav-disabled");
    else this.removeClass(prev, "nav-disabled");
    if (this.questionIndex >= maxIndex) this.addClass(next, "nav-disabled");
    else this.removeClass(next, "nav-disabled");
  }

  private goPrevious = (): void => {
    if (!this.isFivePartsChallenge() || this.questionIndex <= 0) return;
    if (!this.beginNav()) return;
    this.questionIndex -= 1;
    this.renderCurrentView();
  };

  private goNext = (): void => {
    if (!this.isFivePartsChallenge()) return;
    const maxIndex = this.reviewResults
      ? this.questions.length
      : Math.max(0, this.questions.length - 1);
    if (this.questionIndex >= maxIndex) return;
    if (!this.beginNav()) return;
    this.questionIndex += 1;
    this.renderCurrentView();
  };

  private beginNav(): boolean {
    const now = performance.now();
    if (now - this.lastNavAt < 200) return false;
    this.lastNavAt = now;
    return true;
  };

  private selectAnswer(index: number): void {
    if (!this.challenge || this.submitted || this.timeExpired) {
      return;
    }

    this.selectedIndex = index;
    if (this.isFivePartsChallenge()) {
      this.selections[this.questionIndex] = index;
    }
    this.setFeedback("");
    this.updateSelection();
    this.updateSubmitButton();
  }

  private closeResult = (): void => {
    if (this.timeExpired) {
      this.setVisible(false);
      return;
    }
    if (this.challenge && !this.submitted) return;
    this.setVisible(false);
  };

  private submitAnswer = (): void => {
    if (!this.challenge || this.submitted || this.timeExpired) {
      return;
    }

    if (this.isFivePartsChallenge()) {
      if (!this.allQuestionsAnswered()) {
        this.setFeedback("Answer all 5 questions before submitting.");
        return;
      }
      this.submitted = true;
      this.responseTimeSeconds = Math.max(
        0,
        (Date.now() - this.challenge.startedAt) / 1000
      );
      this.stopTimer();
      this.setFeedback("Answer submitted...");
      socket.emit("quickChallengeAnswer", {
        quizId: this.challenge.id,
        answers: this.selections,
      });
      return;
    }

    if (this.selectedIndex === null) {
      this.setFeedback("Please select one answer first.");
      return;
    }

    this.submitted = true;
    this.responseTimeSeconds = Math.max(
      0,
      (Date.now() - this.challenge.startedAt) / 1000
    );
    this.stopTimer();
    this.setFeedback("Answer submitted...");

    socket.emit("quickChallengeAnswer", {
      quizId: this.challenge.id,
      selectedIndex: this.selectedIndex,
      questionIndex: this.questionIndex,
    });
  };

  private showResult = (
    result: QuickChallengeResult
  ): void => {
    if (!this.challenge || result.quizId !== this.challenge.id) {
      return;
    }

    this.submitted = true;
    this.stopTimer();
    if (Number.isFinite(result.responseTimeSeconds)) {
      this.responseTimeSeconds = Number(result.responseTimeSeconds);
    }
    if (Number.isInteger(result.correctCount)) {
      this.correctCount = Number(result.correctCount);
    }

    if (this.isFivePartsChallenge()) {
      this.reviewResults = Array.isArray(result.results)
        ? result.results.map(item => ({
            selectedIndex: item.selectedIndex,
            correctIndex: item.correctIndex,
            correct: item.correct,
          }))
        : this.selections.map(selectedIndex => ({
            selectedIndex: selectedIndex ?? 0,
            correctIndex: 0,
            correct: false,
          }));
      this.questionIndex = this.questions.length;
      this.renderSummaryView();
      return;
    }

    this.showResultCard(result);
  };

  private endChallenge = (
    payload: QuickChallengeEndedPayload = {}
  ): void => {
    if (
      payload.quizId &&
      this.challenge &&
      payload.quizId !== this.challenge.id
    ) {
      return;
    }

    this.stopTimer();
    if (payload.stoppedByInstructor) {
      this.challenge = undefined;
      this.setResultMode(false);
      this.setVisible(false);
      return;
    }

    if (this.submitted) {
      // Preserve a graded result, including non-series challenges.
      return;
    }

    this.setText("quiz-result-status", "TIME'S UP");
    this.setText("quiz-result-answer", "");
    this.setText("quiz-result-time", "Time taken: —");
    this.setText("quiz-result-winner", "");
    const card = this.document?.getElementById("quiz-result-card");
    const status = this.document?.getElementById("quiz-result-status");
    this.removeClass(card, "quiz-result-correct", "quiz-result-wrong");
    this.removeClass(status, "quiz-result-correct", "quiz-result-wrong");
    this.addClass(card, "quiz-result-wrong");
    this.addClass(status, "quiz-result-wrong");
    this.setCloseButtonLabel("RETURN TO CLASS");
    this.setResultMode(true);
    this.addClass(this.document?.getElementById("quiz-nav"), "answer-hidden");
    this.setVisible(true);
    this.challenge = undefined;
  };

  private startTimer(): void {
    this.stopTimer();
    this.updateTimer();
    this.timer = window.setInterval(
      () => this.updateTimer(),
      250
    );
  }

  private getRemainingSeconds(): number {
    if (!this.challenge) return 0;
    const elapsedSeconds = Math.floor(
      (Date.now() - this.challenge.startedAt) / 1000
    );
    return Math.max(0, this.challenge.durationSeconds - elapsedSeconds);
  }

  private updateTimer(): void {
    if (!this.challenge) {
      return;
    }

    const remaining = this.getRemainingSeconds();
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    this.setText(
      "quiz-timer",
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    );

    if (remaining === 0) {
      this.stopTimer();
      this.timeExpired = true;
      if (!this.submitted && !this.isFivePartsChallenge()) {
        this.setFeedback(
          "Time is up.",
          "feedback-incorrect"
        );
      }
    }
  }

  private updateSelection(): void {
    const review = this.reviewResults?.[this.questionIndex];
    for (let index = 0; index < 4; index += 1) {
      const button =
        this.document?.getElementById(
          `quiz-answer-${index}`
        );

      this.removeClass(
        button,
        "answer-selected",
        "answer-correct",
        "answer-wrong"
      );

      if (this.submitted && this.isFivePartsChallenge() && review) {
        if (index === review.correctIndex) {
          this.addClass(button, "answer-correct");
        } else if (index === review.selectedIndex && !review.correct) {
          this.addClass(button, "answer-wrong");
        }
        continue;
      }

      if (index === this.selectedIndex) {
        this.addClass(button, "answer-selected");
      }
    }

    this.sync();
  }

  private showResultCard(result: QuickChallengeResult): void {
    const selectedIndex = result.selectedIndex ?? this.selectedIndex;
    const selectedOption =
      selectedIndex === null || selectedIndex === undefined
        ? "No answer"
        : (this.questions[this.questionIndex]?.options.length ?? 0) <= 2
          ? (this.questions[this.questionIndex]?.options[selectedIndex] ?? "")
          : `${String.fromCharCode(65 + selectedIndex)}. ${
              this.questions[this.questionIndex]?.options[selectedIndex] ?? ""
            }`;
    const status = result.correct ? "CORRECT" : "WRONG";

    this.setText("quiz-result-status", status);
    this.setText("quiz-result-answer", `Your answer: ${selectedOption}`);
    this.setText(
      "quiz-result-time",
      `Time taken: ${this.responseTimeSeconds.toFixed(1)} seconds`
    );
    this.setText("quiz-result-winner", "");
    this.setCloseButtonLabel("RETURN TO CLASS");

    const card = this.document?.getElementById("quiz-result-card");
    const statusElement = this.document?.getElementById("quiz-result-status");
    this.removeClass(card, "quiz-result-correct", "quiz-result-wrong");
    this.removeClass(statusElement, "quiz-result-correct", "quiz-result-wrong");
    this.addClass(
      card,
      result.correct ? "quiz-result-correct" : "quiz-result-wrong"
    );
    this.addClass(
      statusElement,
      result.correct ? "quiz-result-correct" : "quiz-result-wrong"
    );
    this.setResultMode(true);
  }

  private setCloseButtonLabel(text: string): void {
    this.setText("quiz-result-close", text);
  }

  private setResultMode(showResult: boolean): void {
    const contentIds = [
      "quiz-question",
      "quiz-answer-row-1",
      "quiz-answer-row-2",
      "quiz-instruction",
      "quiz-actions",
      "quiz-feedback",
    ];

    contentIds.forEach(id => {
      const element = this.document?.getElementById(id);
      if (showResult) this.addClass(element, "quiz-content-hidden");
      else this.removeClass(element, "quiz-content-hidden");
    });

    const resultCard = this.document?.getElementById("quiz-result-card");
    if (showResult) this.removeClass(resultCard, "quiz-result-hidden");
    else this.addClass(resultCard, "quiz-result-hidden");
    this.showingResult = showResult;
    this.sync();
  }

  private setFeedback(
    text: string,
    className?: string
  ): void {
    const element =
      this.document?.getElementById("quiz-feedback");

    this.removeClass(
      element,
      "feedback-correct",
      "feedback-incorrect"
    );

    if (className) {
      this.addClass(element, className);
    }

    this.setText("quiz-feedback", text);
  }

  private setText(id: string, text: string): void {
    const element =
      this.document?.getElementById(id) as UIKit.Text;

    element?.setProperties({ text });
    this.sync();
  }

  private addClass(element: any, ...classNames: string[]): void {
    if (!element?.classList) return;
    classNames.forEach(className => {
      if (!element.classList.contains(className)) {
        element.classList.add(className);
      }
    });
  }

  private removeClass(element: any, ...classNames: string[]): void {
    if (!element?.classList) return;
    classNames.forEach(className => {
      if (element.classList.contains(className)) {
        element.classList.remove(className);
      }
    });
  }

  private setVisible(visible: boolean): void {
    const entity = (window as any).quickChallengeEntity;

    this.setOtherStudentUiDisabled(visible);

    if (entity?.object3D) {
      if (visible && !entity.object3D.visible) {
        const viewer = this.renderer.xr.isPresenting
          ? this.renderer.xr.getCamera() : this.camera;
        const eye = viewer.getWorldPosition(new Vector3());
        const direction = viewer.getWorldDirection(new Vector3());
        // Center on the current view once when opened, including browser
        // camera pitch. Keep this world transform as the student moves.
        entity.object3D.position.copy(eye).addScaledVector(direction, 1.6);
        viewer.getWorldQuaternion(entity.object3D.quaternion);
      }
      entity.object3D.visible = visible;
      entity.object3D.pointerEvents = visible ? "auto" : "none";
      entity.object3D.pointerEventsOrder = 50000;
      entity.object3D.traverse((object: any) => {
        object.pointerEvents = visible ? "auto" : "none";
        object.pointerEventsOrder = 50000;
      });
      entity.object3D.updateMatrixWorld(true);

      if (visible) {
        // The panel is initially created while hidden. Requalifying it after
        // UIKit has built the button meshes refreshes IWSDK's mouse/ray hit
        // targets and BVHs for both desktop and headset input.
        entity.removeComponent(RayInteractable);
        entity.addComponent(RayInteractable);
        requestAnimationFrame(() => {
          entity.object3D?.updateMatrixWorld(true);
        });
      }
    }

    (window as any).isQuickChallengeOpen = visible;

    window.dispatchEvent(
      new CustomEvent(
        "quickChallengeVisibilityChanged",
        {
          detail: { visible }
        }
      )
    );
  }

  private setOtherStudentUiDisabled(disabled: boolean): void {
    if (disabled) {
      if (this.disabledRayTargets.length > 0) return;

      const names = [
        "menuEntity",
        "panelEntity",
        "hintEntity",
        "raiseHandEntity",
        "studentBoardViewButtonEntity",
        "notificationEntity",
        "transitionEntity",
        "studentResultEntity",
      ];

      names.forEach(name => {
        const target = (window as any)[name];
        const object = target?.object3D;
        if (!target || !object || target === (window as any).quickChallengeEntity) {
          return;
        }

        const hadRayInteractable = Boolean(
          target.hasComponent?.(RayInteractable)
        );
        this.disabledRayTargets.push({
          entity: target,
          wasVisible: object.visible,
          pointerEvents: object.pointerEvents,
          hadRayInteractable,
        });
        object.visible = false;
        object.pointerEvents = "none";
        object.traverse((child: any) => {
          child.pointerEvents = "none";
        });
        if (hadRayInteractable) {
          target.removeComponent(RayInteractable);
        }
      });
      return;
    }

    this.disabledRayTargets.forEach(record => {
      const object = record.entity?.object3D;
      if (!object) return;
      object.visible = record.wasVisible;
      object.pointerEvents = record.pointerEvents ?? "auto";
      object.traverse((child: any) => {
        child.pointerEvents = record.pointerEvents ?? "auto";
      });
      if (
        record.hadRayInteractable &&
        !record.entity.hasComponent?.(RayInteractable)
      ) {
        record.entity.addComponent?.(RayInteractable);
      }
    });
    this.disabledRayTargets = [];
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private sync(): void {
    const document = this.document as any;
    document?.requestUpdate?.();
    document?.update?.();
  }

  destroy(): void {
    this.stopTimer();
    this.setOtherStudentUiDisabled(false);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.handleDesktopPointer,
      true
    );
    socket.off("quickChallengeStarted", this.startChallenge);
    socket.off("quickChallengeResult", this.showResult);
    socket.off("quickChallengeEnded", this.endChallenge);
  }
}
