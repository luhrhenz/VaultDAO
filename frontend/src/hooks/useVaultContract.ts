import { useState, useCallback } from 'react';
import {
    xdr,
    Address,
    Operation,
    TransactionBuilder,
    SorobanRpc,
    nativeToScVal
} from 'stellar-sdk';
import { signTransaction } from '@stellar/freighter-api';
import { useWallet } from '../context/WalletContext'; 
import { parseError } from '../utils/errorParser';

const CONTRACT_ID = "CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const RPC_URL = "https://soroban-testnet.stellar.org";

const server = new SorobanRpc.Server(RPC_URL);

interface StellarBalance {
    asset_type: string;
    balance: string;
}

export const useVaultContract = () => {
    const { address, isConnected } = useWallet();
    const [loading, setLoading] = useState(false);

    const getDashboardStats = useCallback(async () => {
        try {
            const accountInfo = await server.getAccount(CONTRACT_ID) as unknown as { balances: StellarBalance[] };
            const nativeBalance = accountInfo.balances.find((b: StellarBalance) => b.asset_type === 'native');
            const balance = nativeBalance ? parseFloat(nativeBalance.balance).toLocaleString() : "0";

            return {
                totalBalance: balance,
                totalProposals: 24,
                pendingApprovals: 3,
                readyToExecute: 1,
                activeSigners: 5,
                threshold: "3/5"
            };
        } catch (e) {
            console.error("Failed to fetch dashboard stats:", e);
            return {
                totalBalance: "0",
                totalProposals: 0,
                pendingApprovals: 0,
                readyToExecute: 0,
                activeSigners: 0,
                threshold: "0/0"
            };
        }
    }, []);

    const proposeTransfer = async (recipient: string, token: string, amount: string, memo: string) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(NETWORK_PASSPHRASE)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
                            functionName: "propose_transfer",
                            args: [
                                new Address(address).toScVal(),
                                new Address(recipient).toScVal(),
                                new Address(token).toScVal(),
                                nativeToScVal(BigInt(amount)),
                                xdr.ScVal.scvSymbol(memo),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();

            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: "TESTNET" });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, NETWORK_PASSPHRASE));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const rejectProposal = async (proposalId: number) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(NETWORK_PASSPHRASE)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
                            functionName: "reject_proposal",
                            args: [
                                new Address(address).toScVal(),
                                nativeToScVal(BigInt(proposalId), { type: "u64" }),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();

            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: "TESTNET" });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, NETWORK_PASSPHRASE));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    return { proposeTransfer, getDashboardStats, rejectProposal, loading };
};