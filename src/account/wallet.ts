import { StarknetChainId } from '../constants';
import { buildUDCCall } from '../utils/transaction';
import {
  AccountChangeEventHandler,
  AddDeclareTransactionResult,
  AddDeployAccountTransactionResult,
  AddInvokeTransactionResult,
  AddStarknetChainParameters,
  ConnectedStarknetWindowObject,
  NetworkChangeEventHandler,
  RpcMessage,
  WatchAssetParameters,
} from './getst/main';
// eslint-disable-next-line import/no-cycle
import {
  Account,
  AllowArray,
  ArraySignatureType,
  CairoVersion,
  Call,
  CallData,
  CompiledSierra,
  DeclareContractPayload,
  DeployAccountContractPayload,
  MultiDeployContractResponse,
  ProviderInterface,
  ProviderOptions,
  TypedData,
  UniversalDeployerContractPayload,
  extractContractHashes,
  json,
} from '..';

// ---- TT Request Handler
type RpcCall = Omit<RpcMessage, 'result'>;

// -- TT Better naming
// This is provider object expected by WalletAccount to communicate with wallet
interface StarknetWalletProvider extends ConnectedStarknetWindowObject {}

// Represent 'Selected Active' Account inside Connected Wallet
export class WalletAccount extends Account {
  public address: string;

  public walletProvider: StarknetWalletProvider;

  constructor(
    providerOrOptions: ProviderOptions | ProviderInterface,
    walletProvider: StarknetWalletProvider,
    cairoVersion?: CairoVersion
  ) {
    if (!walletProvider.isConnected) throw Error('StarknetWalletProvider should be connected');
    const address = walletProvider.selectedAddress;
    super(providerOrOptions, address, '', cairoVersion);
    this.walletProvider = walletProvider;
    this.address = address.toLowerCase();

    // Event Listeners
    this.walletProvider.on('accountsChanged', () => {
      this.address = walletProvider.selectedAddress;
    });
  }

  /**
   * WALLET EVENTS
   */
  public onAccountChange(callback: AccountChangeEventHandler) {
    this.walletProvider.on('accountsChanged', callback);
  }

  public onNetworkChanged(callback: NetworkChangeEventHandler) {
    this.walletProvider.on('networkChanged', callback);
  }

  /**
   * WALLET SPECIFIC METHODS
   */

  /**
   * Request Permission for wallet account, return addresses that's allowed by user
   * @param silentMode false: request user interaction allowance. true: return only pre-allowed
   * @returns allowed accounts addresses
   */
  public requestAccounts(silentMode = false) {
    const rpcCall: RpcCall = {
      type: 'wallet_requestAccounts',
      params: {
        silentMode,
      },
    };
    return this.walletProvider.request(rpcCall) as Promise<string[]>;
  }

  /**
   * Request Wallet Network change
   * @param chainId StarknetChainId
   * @returns boolean
   */
  public switchStarknetChain(chainId: StarknetChainId) {
    const rpcCall: RpcCall = {
      type: 'wallet_switchStarknetChain',
      params: {
        chainId,
      },
    };
    return this.walletProvider.request(rpcCall) as Promise<boolean>;
  }

  /**
   * Request adding ERC20 Token to Wallet List
   * @param asset WatchAssetParameters
   * @returns boolean
   */
  public watchAsset(asset: WatchAssetParameters) {
    const rpcCall: RpcCall = {
      type: 'wallet_watchAsset',
      params: asset,
    };
    return this.walletProvider.request(rpcCall) as Promise<boolean>;
  }

  /**
   * Request adding custom Starknet chain
   * @param chain AddStarknetChainParameters
   * @returns boolean
   */
  public addStarknetChain(chain: AddStarknetChainParameters) {
    // Can this set custom RPC endpoint ?
    const rpcCall: RpcCall = {
      type: 'wallet_addStarknetChain',
      params: chain,
    };
    return this.walletProvider.request(rpcCall) as Promise<boolean>;
  }

  /**
   * ACCOUNT METHODS
   */
  override execute(calls: AllowArray<Call>) {
    const txCalls = [].concat(calls as any).map((it) => {
      const { contractAddress, entrypoint, calldata } = it;
      return {
        contract_address: contractAddress,
        entrypoint,
        calldata,
      };
    });

    const rpcCall: RpcCall = {
      type: 'starknet_addInvokeTransaction',
      params: {
        calls: txCalls,
      },
    };
    return this.walletProvider.request(rpcCall) as Promise<AddInvokeTransactionResult>;
  }

  override declare(payload: DeclareContractPayload) {
    const declareContractPayload = extractContractHashes(payload);

    // DISCUSS: HOTFIX: Adapt Abi format
    const pContract = payload.contract as CompiledSierra;
    const cairo1Contract = {
      ...pContract,
      abi: json.stringify(pContract.abi),
    };

    // Check FIx
    if (!declareContractPayload.compiledClassHash) {
      throw Error('compiledClassHash is required');
    }

    const rpcCall: RpcCall = {
      type: 'starknet_addDeclareTransaction',
      params: {
        compiled_class_hash: declareContractPayload.compiledClassHash,
        contract_class: cairo1Contract,
      },
    };
    return this.walletProvider.request(rpcCall) as Promise<AddDeclareTransactionResult>;
  }

  override async deploy(
    payload: UniversalDeployerContractPayload | UniversalDeployerContractPayload[]
  ): Promise<MultiDeployContractResponse> {
    const { calls, addresses } = buildUDCCall(payload, this.address);
    const invokeResponse = await this.execute(calls);

    return {
      ...invokeResponse,
      contract_address: addresses,
    };
  }

  override deployAccount(payload: DeployAccountContractPayload) {
    const rpcCall: RpcCall = {
      type: 'starknet_addDeployAccountTransaction',
      params: {
        contract_address_salt: payload.addressSalt?.toString() || '0',
        constructor_calldata: payload.constructorCalldata
          ? CallData.compile(payload.constructorCalldata)
          : [],
        class_hash: payload.classHash,
      },
    };
    return this.walletProvider.request(rpcCall) as Promise<AddDeployAccountTransactionResult>;
  }

  override signMessage(typedData: TypedData) {
    const rpcCall: RpcCall = {
      type: 'starknet_signTypedData',
      params: typedData,
    };
    return this.walletProvider.request(rpcCall) as Promise<ArraySignatureType>;
  }

  // MISSING ESTIMATES
}