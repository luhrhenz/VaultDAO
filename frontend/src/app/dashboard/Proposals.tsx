import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import { useToast } from '../../context/ToastContext';
import { useVaultContract } from '../../hooks/useVaultContract';
import ConfirmationModal from '../../components/ConfirmationModal';
import NewProposalModal, { type NewProposalFormData } from '../../components/NewProposalModal';
import ProposalTemplates from '../../components/ProposalTemplates';
import {
    createTemplate,
    extractTemplateVariables,
    getTemplateById,
    interpolateTemplate,
    recordTemplateUsage,
    TEMPLATE_CATEGORIES,
    type ProposalTemplate,
} from '../../utils/templates';

interface Proposal {
    id: number;
    proposer: string;
    recipient: string;
    amount: string;
    token: string;
    memo: string;
    status: 'Pending' | 'Approved' | 'Executed' | 'Rejected' | 'Expired';
    approvals: number;
    threshold: number;
    createdAt: string;
}

const mockProposals: Proposal[] = [
    {
        id: 1,
        proposer: 'GABC...XYZ1',
        recipient: 'GDEF...ABC2',
        amount: '1000',
        token: 'USDC',
        memo: 'Marketing budget',
        status: 'Pending',
        approvals: 1,
        threshold: 3,
        createdAt: '2024-02-15',
    },
    {
        id: 2,
        proposer: 'GABC...XYZ1',
        recipient: 'GHIJ...DEF3',
        amount: '500',
        token: 'XLM',
        memo: 'Development costs',
        status: 'Approved',
        approvals: 3,
        threshold: 3,
        createdAt: '2024-02-14',
    },
];

const Proposals: React.FC = () => {
    const { address, isConnected } = useWallet();
    const { proposeTransfer, rejectProposal, loading } = useVaultContract();
    const [searchParams, setSearchParams] = useSearchParams();
    const [proposals, setProposals] = useState<Proposal[]>(mockProposals);
    const [selectedProposal, setSelectedProposal] = useState<number | null>(null);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [showNewProposalModal, setShowNewProposalModal] = useState(false);
    const [showTemplateSelector, setShowTemplateSelector] = useState(false);
    const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null);
    const [newProposalForm, setNewProposalForm] = useState<NewProposalFormData>({
        recipient: '',
        token: '',
        amount: '',
        memo: '',
    });
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const userRole = 'Admin'; 

    const canRejectProposal = (proposal: Proposal): boolean => {
        if (!isConnected || !address) return false;
        return proposal.proposer === address || userRole === 'Admin';
    };

    const handleRejectClick = (proposalId: number) => {
        setSelectedProposal(proposalId);
        setShowRejectModal(true);
    };

    const handleRejectConfirm = async (reason?: string) => {
        if (selectedProposal === null) return;

        try {
            const txHash = await rejectProposal(selectedProposal);
            
            // Update local state
            setProposals((prev) =>
                prev.map((proposal) =>
                    proposal.id === selectedProposal ? { ...proposal, status: 'Rejected' as const } : proposal
                )
            );

            notify(
                'proposal_rejected',
                `Proposal #${selectedProposal} rejected successfully`,
                'success'
            );

            console.log('Rejection reason:', reason);
            console.log('Transaction hash:', txHash);
        } catch (error: unknown) {
            // Show error toast
            const message = error instanceof Error ? error.message : 'Failed to reject proposal';
            setToast({
                message,
                type: 'error',
            });
        } finally {
            setShowRejectModal(false);
            setSelectedProposal(null);
        }
    };

    const handleRejectCancel = () => {
        setShowRejectModal(false);
        setSelectedProposal(null);
    };

    // Auto-hide toast after 5 seconds
    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    const applyTemplate = useCallback(
        (template: ProposalTemplate) => {
            const variables = extractTemplateVariables(template).variableNames;
            const values: Record<string, string> = {};

            for (const variable of variables) {
                const input = window.prompt(`Enter value for ${variable}`, '');
                if (input === null) {
                    return;
                }
                values[variable] = input.trim();
            }

            const interpolated = interpolateTemplate(template, values);
            setNewProposalForm({
                recipient: interpolated.recipient,
                amount: interpolated.amount,
                token: interpolated.token,
                memo: interpolated.memo,
            });
            setSelectedTemplateName(template.name);
            recordTemplateUsage(template.id);
            setShowTemplateSelector(false);
            setShowNewProposalModal(true);
            setToast({
                message: `Applied template "${template.name}"`,
                type: 'success',
            });
        },
        []
    );

    useEffect(() => {
        const templateId = searchParams.get('template');
        if (!templateId) {
            return;
        }

        const template = getTemplateById(templateId);
        if (template) {
            applyTemplate(template);
        } else {
            setToast({
                message: 'Template not found',
                type: 'error',
            });
        }
        setSearchParams({}, { replace: true });
    }, [applyTemplate, searchParams, setSearchParams]);

    const handleFormChange = (field: keyof NewProposalFormData, value: string) => {
        setNewProposalForm((prev) => ({ ...prev, [field]: value }));
    };

    const resetNewProposalForm = () => {
        setNewProposalForm({
            recipient: '',
            token: '',
            amount: '',
            memo: '',
        });
        setSelectedTemplateName(null);
    };

    const handleSaveAsTemplate = () => {
        const name = window.prompt('Template name', '');
        if (!name) {
            return;
        }

        const categoryInput = window.prompt(
            `Template category (${TEMPLATE_CATEGORIES.join(', ')})`,
            'Custom'
        );
        if (!categoryInput) {
            return;
        }
        const normalizedCategory = TEMPLATE_CATEGORIES.find(
            (category) => category.toLowerCase() === categoryInput.toLowerCase()
        );
        if (!normalizedCategory) {
            setToast({
                message: 'Invalid template category',
                type: 'error',
            });
            return;
        }

        const description = window.prompt('Template description', '') ?? '';

        try {
            createTemplate(
                name,
                normalizedCategory,
                description,
                newProposalForm.recipient,
                newProposalForm.amount,
                newProposalForm.token,
                newProposalForm.memo
            );
            setToast({
                message: `Saved template "${name}"`,
                type: 'success',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save template';
            setToast({
                message,
                type: 'error',
            });
        }
    };

    const handleCreateProposal = async (event: React.FormEvent) => {
        event.preventDefault();
        if (
            !newProposalForm.recipient.trim() ||
            !newProposalForm.token.trim() ||
            !newProposalForm.amount.trim() ||
            !newProposalForm.memo.trim()
        ) {
            setToast({
                message: 'All proposal fields are required',
                type: 'error',
            });
            return;
        }

        try {
            const txHash = await proposeTransfer(
                newProposalForm.recipient.trim(),
                newProposalForm.token.trim(),
                newProposalForm.amount.trim(),
                newProposalForm.memo.trim()
            );

            const nextId = proposals.length === 0 ? 1 : Math.max(...proposals.map((proposal) => proposal.id)) + 1;
            const proposer = address ?? 'Connected signer';
            const createdAt = new Date().toISOString().slice(0, 10);
            setProposals((prev) => [
                {
                    id: nextId,
                    proposer,
                    recipient: newProposalForm.recipient.trim(),
                    amount: newProposalForm.amount.trim(),
                    token: newProposalForm.token.trim(),
                    memo: newProposalForm.memo.trim(),
                    status: 'Pending',
                    approvals: 0,
                    threshold: 3,
                    createdAt,
                },
                ...prev,
            ]);

            setToast({
                message: `Proposal created. Tx: ${txHash.slice(0, 10)}...`,
                type: 'success',
            });
            setShowNewProposalModal(false);
            resetNewProposalForm();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create proposal';
            setToast({
                message,
                type: 'error',
            });
        }
    };

    const getStatusColor = (status: Proposal['status']) => {
        switch (status) {
            case 'Pending': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
            case 'Approved': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
            case 'Executed': return 'bg-green-500/10 text-green-400 border-green-500/20';
            case 'Rejected': return 'bg-red-500/10 text-red-400 border-red-500/20';
            case 'Expired': return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
            default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <h2 className="text-3xl font-bold">Proposals</h2>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                        type="button"
                        onClick={() => setShowTemplateSelector(true)}
                        className="min-h-[44px] rounded-lg bg-gray-700 px-4 py-2 font-medium text-white transition-colors hover:bg-gray-600"
                    >
                        Use Template
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowNewProposalModal(true)}
                        className="min-h-[44px] rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-700"
                    >
                        New Proposal
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                {proposals.length === 0 ? (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center text-gray-400">
                        <p>No proposals found.</p>
                    </div>
                ) : (
                    proposals.map((proposal) => (
                        <div key={proposal.id} className="bg-gray-800 rounded-xl border border-gray-700 p-4 sm:p-6">
                            <div className="space-y-4">
                                <div className="flex justify-between items-start gap-4">
                                    <div>
                                        <h3 className="text-lg font-semibold text-white">Proposal #{proposal.id}</h3>
                                        <p className="text-sm text-gray-400 mt-1">{proposal.memo}</p>
                                    </div>
                                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(proposal.status)}`}>
                                        {proposal.status}
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="text-gray-400">Amount:</span>
                                        <span className="text-white ml-2 font-medium">{proposal.amount} {proposal.token}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Approvals:</span>
                                        <span className="text-white ml-2 font-medium">{proposal.approvals}/{proposal.threshold}</span>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <span className="text-gray-400">Recipient:</span>
                                        <span className="text-white ml-2 font-mono text-xs">{proposal.recipient}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Created:</span>
                                        <span className="text-white ml-2">{proposal.createdAt}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                                    {proposal.status === 'Pending' && (
                                        <>
                                            <button className="flex-1 sm:flex-none bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
                                                Approve
                                            </button>
                                            {canRejectProposal(proposal) && (
                                                <button
                                                    onClick={() => handleRejectClick(proposal.id)}
                                                    disabled={loading}
                                                    className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
                                                >
                                                    {loading && selectedProposal === proposal.id ? 'Rejecting...' : 'Reject'}
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {proposal.status === 'Approved' && (
                                        <button className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
                                            Execute
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <ConfirmationModal
                isOpen={showRejectModal}
                title="Reject Proposal"
                message="Are you sure you want to reject this proposal? This action is permanent."
                confirmText="Reject Proposal"
                cancelText="Cancel"
                onConfirm={handleRejectConfirm}
                onCancel={handleRejectCancel}
                showReasonInput={true}
                isDestructive={true}
            />

            {/* Template Selector Modal */}
            {showTemplateSelector ? (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
                    <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-4 sm:p-6">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-xl font-semibold text-white">Select Template</h3>
                            <button
                                type="button"
                                onClick={() => setShowTemplateSelector(false)}
                                className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-white hover:bg-gray-600"
                            >
                                Close
                            </button>
                        </div>
                        <ProposalTemplates onUseTemplate={applyTemplate} />
                    </div>
                </div>
            ) : null}

            <NewProposalModal
                isOpen={showNewProposalModal}
                loading={loading}
                selectedTemplateName={selectedTemplateName}
                formData={newProposalForm}
                onFieldChange={handleFormChange}
                onSubmit={handleCreateProposal}
                onOpenTemplateSelector={() => setShowTemplateSelector(true)}
                onSaveAsTemplate={handleSaveAsTemplate}
                onClose={() => {
                    setShowNewProposalModal(false);
                    resetNewProposalForm();
                }}
            />
        </div>
    );
};

export default Proposals;