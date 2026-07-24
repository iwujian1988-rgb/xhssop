'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { WorkflowState, WorkflowAction, INITIAL_STATE, WorkflowStep } from '@/types/workflow';
import { SkillData, ChainId, CoverTemplateId, TitleTemplateId, PageTemplateId } from '@/types/data';
import { workflowReducer, deriveStep, canExecuteStep } from '@/lib/state-machine';
import { loadSkillData } from '@/lib/data-loader';

interface WorkflowContextValue {
  state: WorkflowState;
  dispatch: (action: WorkflowAction) => void;
  data: SkillData | null;
  loading: boolean;
  currentStep: WorkflowStep;
  canProceed: (step: WorkflowStep) => boolean;
  productId: string;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export function WorkflowProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WorkflowState>(INITIAL_STATE);
  const [data, setData] = useState<SkillData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSkillData()
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load skill data:', err);
        setLoading(false);
      });
  }, []);

  const dispatch = useCallback(
    (action: WorkflowAction) => {
      if (!data) return;
      setState(prev => workflowReducer(prev, action, data));
    },
    [data],
  );

  const currentStep = deriveStep(state);
  const canProceed = useCallback(
    (step: WorkflowStep) => canExecuteStep(step, state),
    [state],
  );

  const productId = state.chain_id && data
    ? data.chains[state.chain_id]?.product_id || ''
    : '';

  return (
    <WorkflowContext.Provider
      value={{ state, dispatch, data, loading, currentStep, canProceed, productId }}
    >
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow() {
  const ctx = useContext(WorkflowContext);
  if (!ctx) throw new Error('useWorkflow must be used within WorkflowProvider');
  return ctx;
}
