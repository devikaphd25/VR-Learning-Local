/** Displays short contextual hints received from the multiplayer server. */
import { createSystem, PanelUI, PanelDocument, UIKitDocument, UIKit } from "@iwsdk/core";
import { socket } from "../network/socket";


interface Hint {
 id: string;
 leftText: string;
 rightText: string;
 createdAt: number;
 duration: number;
 type?: 'info' | 'success' | 'warning';
}


export class HintSystem extends createSystem({
 hintPanel: {
   required: [PanelUI, PanelDocument],
   where: []
 }
}) {
 private hints: Hint[] = [];
 private leftHintElement: HTMLDivElement | null = null;
 private rightHintElement: HTMLDivElement | null = null;
 private isVR = false;
 private hintContainer: HTMLDivElement | null = null;
 private activeHints: Map<string, { left: HTMLElement; right: HTMLElement }> = new Map();
 private hideTimeout: any = null;
 private seatConfirmed = false; // Track if seat is confirmed
 private raiseHandReleased = false;

 init() {
   // Detect VR mode
   this.isVR = !!navigator.xr;
  
   // Setup UI for web mode
   if (!this.isVR) {
     this.setupWebUI();
   } else {
     this.setupVRUI();
   }


   // Setup event listeners
   this.setupEventListeners();
 }


 private setupWebUI() {
   // Create container for hints
   this.hintContainer = document.createElement('div');
   this.hintContainer.style.position = 'fixed';
   this.hintContainer.style.bottom = '0';
   this.hintContainer.style.left = '0';
   this.hintContainer.style.width = '100%';
   this.hintContainer.style.height = 'auto';
   this.hintContainer.style.pointerEvents = 'none';
   this.hintContainer.style.zIndex = '9999';
   this.hintContainer.style.display = 'flex';
   this.hintContainer.style.justifyContent = 'space-between';
   this.hintContainer.style.padding = '20px 30px';
   this.hintContainer.style.boxSizing = 'border-box';
   document.body.appendChild(this.hintContainer);


   // Left hint - bottom left corner
   this.leftHintElement = document.createElement('div');
   this.leftHintElement.style.background = 'rgba(0, 0, 0, 0.6)';
   this.leftHintElement.style.color = 'rgba(255, 255, 255, 0.9)';
   this.leftHintElement.style.padding = '10px 16px';
   this.leftHintElement.style.borderRadius = '6px';
   this.leftHintElement.style.fontSize = '13px';
   this.leftHintElement.style.fontWeight = '400';
   this.leftHintElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
   this.leftHintElement.style.letterSpacing = '0.3px';
   this.leftHintElement.style.backdropFilter = 'blur(8px)';
   this.leftHintElement.style.border = '1px solid rgba(255, 255, 255, 0.1)';
   this.leftHintElement.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
   this.leftHintElement.style.maxWidth = '280px';
   this.leftHintElement.style.opacity = '0';
   this.leftHintElement.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
   this.leftHintElement.style.transform = 'translateY(10px)';
   this.leftHintElement.style.display = 'none';
   this.leftHintElement.style.pointerEvents = 'none';
   this.hintContainer.appendChild(this.leftHintElement);


   // Right hint - bottom right corner
   this.rightHintElement = document.createElement('div');
   this.rightHintElement.style.background = 'rgba(0, 0, 0, 0.6)';
   this.rightHintElement.style.color = 'rgba(255, 255, 255, 0.9)';
   this.rightHintElement.style.padding = '10px 16px';
   this.rightHintElement.style.borderRadius = '6px';
   this.rightHintElement.style.fontSize = '13px';
   this.rightHintElement.style.fontWeight = '400';
   this.rightHintElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
   this.rightHintElement.style.letterSpacing = '0.3px';
   this.rightHintElement.style.backdropFilter = 'blur(8px)';
   this.rightHintElement.style.border = '1px solid rgba(255, 255, 255, 0.1)';
   this.rightHintElement.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
   this.rightHintElement.style.maxWidth = '280px';
   this.rightHintElement.style.opacity = '0';
   this.rightHintElement.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
   this.rightHintElement.style.transform = 'translateY(10px)';
   this.rightHintElement.style.display = 'none';
   this.rightHintElement.style.pointerEvents = 'none';
   this.hintContainer.appendChild(this.rightHintElement);
 }


 private setupVRUI() {
   // For VR mode, create bottom corner hints as overlays
   console.log('VR mode detected - showing bottom corner hints');
  
   // Create container for VR hints
   this.hintContainer = document.createElement('div');
   this.hintContainer.style.position = 'fixed';
   this.hintContainer.style.bottom = '0';
   this.hintContainer.style.left = '0';
   this.hintContainer.style.width = '100%';
   this.hintContainer.style.height = 'auto';
   this.hintContainer.style.pointerEvents = 'none';
   this.hintContainer.style.zIndex = '9999';
   this.hintContainer.style.display = 'flex';
   this.hintContainer.style.justifyContent = 'space-between';
   this.hintContainer.style.padding = '30px 40px';
   this.hintContainer.style.boxSizing = 'border-box';
   document.body.appendChild(this.hintContainer);


   // Left hint - bottom left for VR
   this.leftHintElement = document.createElement('div');
   this.leftHintElement.style.background = 'rgba(0, 0, 0, 0.7)';
   this.leftHintElement.style.color = 'rgba(255, 255, 255, 0.95)';
   this.leftHintElement.style.padding = '12px 20px';
   this.leftHintElement.style.borderRadius = '8px';
   this.leftHintElement.style.fontSize = '14px';
   this.leftHintElement.style.fontWeight = '400';
   this.leftHintElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
   this.leftHintElement.style.letterSpacing = '0.3px';
   this.leftHintElement.style.backdropFilter = 'blur(10px)';
   this.leftHintElement.style.border = '1px solid rgba(255, 255, 255, 0.15)';
   this.leftHintElement.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)';
   this.leftHintElement.style.maxWidth = '300px';
   this.leftHintElement.style.opacity = '0';
   this.leftHintElement.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
   this.leftHintElement.style.transform = 'translateY(10px)';
   this.leftHintElement.style.display = 'none';
   this.leftHintElement.style.pointerEvents = 'none';
   this.hintContainer.appendChild(this.leftHintElement);


   // Right hint - bottom right for VR
   this.rightHintElement = document.createElement('div');
   this.rightHintElement.style.background = 'rgba(0, 0, 0, 0.7)';
   this.rightHintElement.style.color = 'rgba(255, 255, 255, 0.95)';
   this.rightHintElement.style.padding = '12px 20px';
   this.rightHintElement.style.borderRadius = '8px';
   this.rightHintElement.style.fontSize = '14px';
   this.rightHintElement.style.fontWeight = '400';
   this.rightHintElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
   this.rightHintElement.style.letterSpacing = '0.3px';
   this.rightHintElement.style.backdropFilter = 'blur(10px)';
   this.rightHintElement.style.border = '1px solid rgba(255, 255, 255, 0.15)';
   this.rightHintElement.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)';
   this.rightHintElement.style.maxWidth = '300px';
   this.rightHintElement.style.opacity = '0';
   this.rightHintElement.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
   this.rightHintElement.style.transform = 'translateY(10px)';
   this.rightHintElement.style.display = 'none';
   this.rightHintElement.style.pointerEvents = 'none';
   this.hintContainer.appendChild(this.rightHintElement);
 }


 private setupEventListeners() {
   // Listen for seat confirmation
   socket.on('seatAccepted', () => {
     this.seatConfirmed = true;
    
     // Only show hints after seat is confirmed and player faces stage
     // We'll wait a moment for the teleport to complete
     setTimeout(() => {
       this.showVRControllerHints();
     }, 1500); // Wait 1.5 seconds for teleport to complete
   });
 }


 // New method specifically for VR controller hints after seat confirmation
private showVRControllerHints() {
  const hintDuration = this.isVR ? 10000 : 8000;

  if (!this.isVR) {
    this.showHints(
      "Press M for Menu",
      "Controls Available",
      hintDuration,
      "info"
    );
  } else {
    this.showHints(
      "Press X to open menu",
      "Press A to change mode",
      hintDuration,
      "info"
    );
  }

  /*
   * Wait for:
   * 1. Hint duration
   * 2. The 400 ms fade-out animation
   *
   * Then allow the Raise Hand button to appear.
   */
  setTimeout(() => {
    this.releaseRaiseHandButton();
  }, hintDuration + 450);
}
private releaseRaiseHandButton(): void {
  // Prevent the event from running more than once
  if (this.raiseHandReleased) {
    return;
  }

  this.raiseHandReleased = true;

  (window as any).isHintVisible = false;
  (window as any).isRaiseHandReady = true;

  window.dispatchEvent(
    new CustomEvent("hintFinished")
  );

  console.log(
    "[HintSystem] Hint disappeared — Raise Hand button can appear"
  );
}

 public showHints(
   leftText: string,
   rightText: string,
   duration: number = 5000,
   type: 'info' | 'success' | 'warning' = 'info'
 ) {
   const hintId = `hint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
   // Clear any existing timeout
   if (this.hideTimeout) {
     clearTimeout(this.hideTimeout);
   }


   // Apply style based on type
   this.applyHintStyle(type);


   if (!this.isVR) {
     this.showWebHints(leftText, rightText, hintId, duration);
   } else {
     this.showVRHints(leftText, rightText, hintId, duration);
   }


   // Auto-hide after duration
   this.hideTimeout = setTimeout(() => {
     this.hideHints(hintId);
     this.hideTimeout = null;
   }, duration);
 }


 private applyHintStyle(type: string) {
   const styles = {
     info: {
       leftBorder: '2px solid rgba(96, 165, 250, 0.5)',
       rightBorder: '2px solid rgba(96, 165, 250, 0.5)',
       leftIcon: '💡 ',
       rightIcon: '🎮 '
     },
     success: {
       leftBorder: '2px solid rgba(74, 222, 128, 0.5)',
       rightBorder: '2px solid rgba(74, 222, 128, 0.5)',
       leftIcon: '✅ ',
       rightIcon: '🎉 '
     },
     warning: {
       leftBorder: '2px solid rgba(251, 191, 36, 0.5)',
       rightBorder: '2px solid rgba(251, 191, 36, 0.5)',
       leftIcon: '⚠️ ',
       rightIcon: '⚡ '
     }
   };


   const style = styles[type as keyof typeof styles] || styles.info;
  
   if (this.leftHintElement) {
     this.leftHintElement.style.borderLeft = style.leftBorder;
   }
   if (this.rightHintElement) {
     this.rightHintElement.style.borderRight = style.rightBorder;
   }


   // Store icons for use in text
   (this as any).leftIcon = style.leftIcon;
   (this as any).rightIcon = style.rightIcon;
 }


 private showWebHints(leftText: string, rightText: string, hintId: string, duration: number) {
   if (!this.leftHintElement || !this.rightHintElement) return;


   // Add icons if available
   const leftIcon = (this as any).leftIcon || '';
   const rightIcon = (this as any).rightIcon || '';


   // Update text with icons
   this.leftHintElement.textContent = `${leftIcon}${leftText}`;
   this.rightHintElement.textContent = `${rightText}${rightIcon}`;


   // Show with animation
   this.leftHintElement.style.display = 'block';
   this.rightHintElement.style.display = 'block';


   // Trigger animation
   requestAnimationFrame(() => {
     this.leftHintElement!.style.opacity = '1';
     this.leftHintElement!.style.transform = 'translateY(0)';
     this.rightHintElement!.style.opacity = '1';
     this.rightHintElement!.style.transform = 'translateY(0)';
   });


   // Store hint
   this.hints.push({
     id: hintId,
     leftText,
     rightText,
     createdAt: Date.now(),
     duration
   });
 }


 private showVRHints(leftText: string, rightText: string, hintId: string, duration: number) {
   // Use the same bottom corner approach for VR
   this.showWebHints(leftText, rightText, hintId, duration);
 }


 private hideHints(hintId: string) {
   // Remove from hints array
   this.hints = this.hints.filter(h => h.id !== hintId);


   if (this.leftHintElement && this.rightHintElement) {
     this.leftHintElement.style.opacity = '0';
     this.leftHintElement.style.transform = 'translateY(10px)';
     this.rightHintElement.style.opacity = '0';
     this.rightHintElement.style.transform = 'translateY(10px)';
    
     setTimeout(() => {
       if (this.leftHintElement && this.rightHintElement) {
         this.leftHintElement.style.display = 'none';
         this.rightHintElement.style.display = 'none';
       }
     }, 400);
   }
 }


 public hideAllHints() {
   this.hints.forEach(hint => this.hideHints(hint.id));
   this.hints = [];
   this.activeHints.clear();
   if (this.hideTimeout) {
     clearTimeout(this.hideTimeout);
     this.hideTimeout = null;
   }
 }


 update(delta: number): void {
   // Check for expired hints and remove them
   const now = Date.now();
   this.hints.forEach(hint => {
     if (now - hint.createdAt > hint.duration) {
       this.hideHints(hint.id);
     }
   });
 }
}
