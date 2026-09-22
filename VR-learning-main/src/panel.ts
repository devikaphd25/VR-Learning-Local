/** Builds the legacy classroom control panel and forwards its actions to Socket.IO. */
import {
  createSystem,
  PanelUI,
  PanelDocument,
  eq,
  UIKitDocument,
  UIKit,
  Entity,
  createComponent,
  Types,
  Group,
  Object3DEventMap,
} from "@iwsdk/core";

import { SeatComponent } from "./components/seat.component";
import { SeatType } from "./utils/utils";
import { socket } from "./network/socket";

// NEW: MenuPanelComponent for the menu system
export const MenuPanelComponent = createComponent("MPC", {
  scene: {
    type: Types.Object,
    default: undefined as Group<Object3DEventMap> | undefined,
  },
});

export const PanelSystemComponent = createComponent("PSC", {
  scene: {
    type: Types.Object,
    default: undefined as Group<Object3DEventMap> | undefined,
  },
});


export class PanelSystem extends createSystem({
  welcomePanel: {
    required: [PanelUI, PanelDocument, PanelSystemComponent],
    where: [eq(PanelUI, "config", "./ui/seat-panel.json")],
  },
}) {
  private ROWS = ["1", "2", "3", "4", "5"];
  private SEAT_PER_ROWS = 5;
  private takenSeats: string[] = [];
  private seatEntity!: Entity;
  private panelRoot: any;
  private seatPanelDocument?: UIKitDocument;

 private refreshSeatButtons() {
  if (!this.seatPanelDocument) return;

  for (const row of this.ROWS) {
    for (let i = 1; i <= this.SEAT_PER_ROWS; i++) {
      const seat = this.seatPanelDocument.getElementById(`Seat_R${row}_0${i}`);
      if (!seat) continue;

      const seatName = seat.userData.seat;

      if (this.takenSeats.includes(seatName)) {
        // Swap classes cleanly for the 3D renderer
        seat.classList.remove("seat-available");
        if (!seat.classList.contains("seat-taken")) {
          seat.classList.add("seat-taken");
        }
      } else {
        // Revert back to green
        seat.classList.remove("seat-taken");
        if (!seat.classList.contains("seat-available")) {
          seat.classList.add("seat-available");
        }
      }
    }
  }

  this.syncVRLayout();
}

  // Forces the 3D canvas rendering engine to draw new materials inside the headset context
  private syncVRLayout() {
    if (!this.seatPanelDocument) return;
    
    if (typeof (this.seatPanelDocument as any).update === "function") {
      (this.seatPanelDocument as any).update();
    } else if (typeof (this.seatPanelDocument as any).requestUpdate === "function") {
      (this.seatPanelDocument as any).requestUpdate();
    }
  }

  init() {
    socket.on("studentList", (students: any[]) => {
      this.takenSeats = students
        .map((s) => s.seat)
        .filter((seat) => seat && seat !== "Not selected");

      this.refreshSeatButtons();
    });

    socket.on("seatAccepted", () => {
      this.panelRoot?.classList.add("hide");
    });

    this.seatEntity = this.world.createTransformEntity(this.player);

    this.queries.welcomePanel.subscribe("qualify", (entity) => {
      console.log("[PanelSystem] Panel qualified");

      const document = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!document) {
        console.error("[PanelSystem] No document found");
        return;
      }

      this.seatPanelDocument = document;
      this.panelRoot = document.getElementById("panel-root");
      
      console.log("[PanelSystem] Panel root found:", !!this.panelRoot);

      // Component Guard: Avoid re-adding components if the panel re-qualifies during VR transition
      if (!this.seatEntity.hasComponent(SeatComponent)) {
        this.seatEntity.addComponent(SeatComponent, {
          scene: entity.getValue(PanelSystemComponent, "scene") as Group<Object3DEventMap>,
        });
      }

      // Sync existing application state directly into the new 3D/VR canvas meshes
      this.refreshSeatButtons();
      
      // Pull fresh data from the server timeline to cross isolation environments
      socket.emit("requestStudentList");

      const confirmBtn = document.getElementById("confirm-btn") as UIKit.Text;
      let seatCode = "";

      for (const row of this.ROWS) {
        for (let i = 1; i <= this.SEAT_PER_ROWS; i++) {
          const seatId = `Seat_R${row}_0${i}`;
          const seat = document.getElementById(seatId);
          if (!seat) continue;

          seat.addEventListener("click", () => {
            const selectedSeat = seat.userData.seat;
            console.log(`[PanelSystem] Seat clicked: ${selectedSeat}`);

            if (this.takenSeats.includes(selectedSeat)) {
              const text = document.getElementById("status-text") as UIKit.Text;
              text.setProperties({ text: "Seat already taken" });
              this.syncVRLayout();
              return;
            }

            seatCode = selectedSeat;
            const text = document.getElementById("status-text") as UIKit.Text;
            text.setProperties({ text: seatCode });
            
            this.syncVRLayout();
          });
        }
      }

      confirmBtn.addEventListener("click", () => {
        const text = document.getElementById("status-text") as UIKit.Text;

        if (!seatCode) {
          text.setProperties({ text: "Please select a seat" });
          this.syncVRLayout();
          return;
        }

        if (this.takenSeats.includes(seatCode)) {
          text.setProperties({ text: "Seat already taken" });
          this.syncVRLayout();
          return;
        }

        console.log(`[PanelSystem] Confirming seat: ${seatCode}`);
        this.seatEntity.setValue(SeatComponent, "name", seatCode as SeatType);
        this.syncVRLayout();
      });

      this.syncVRLayout();
    });
  }
}
