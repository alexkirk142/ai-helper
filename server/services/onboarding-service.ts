import type { OnboardingStep, OnboardingStatus } from "@shared/schema";
import { ONBOARDING_STEPS } from "@shared/schema";

export function calculateNextStep(currentStep: OnboardingStep): OnboardingStep {
  const currentIndex = ONBOARDING_STEPS.indexOf(currentStep);
  return currentIndex < ONBOARDING_STEPS.length - 1
    ? ONBOARDING_STEPS[currentIndex + 1]
    : "DONE";
}

export function calculateStatus(nextStep: OnboardingStep): OnboardingStatus {
  return nextStep === "DONE" ? "DONE" : "IN_PROGRESS";
}

export function deduplicateSteps(existingSteps: OnboardingStep[], newStep: OnboardingStep): OnboardingStep[] {
  const stepsSet = new Set(existingSteps);
  stepsSet.add(newStep);
  return Array.from(stepsSet) as OnboardingStep[];
}

export function isValidRole(role: string): boolean {
  return ["operator", "admin", "owner"].includes(role);
}
