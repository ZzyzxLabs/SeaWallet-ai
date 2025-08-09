"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  useCurrentAccount,
  useSuiClientQueries,
  useSuiClientQuery,
  useSignAndExecuteTransaction,
} from "@mysten/dapp-kit";
import CoinAdd from "./coinAdd";
import useMoveStore from "../store/moveStore";
import useHeirStore from "../store/heirStore";
import useCoinStore from "../store/coinStore";
import { useVaultAndOwnerCap, useVaultList } from "../utils/vaultUtils";

const VaultList = () => {
  const account = useCurrentAccount();
  const packageName = useMoveStore((state) => state.packageName);
  const takeCoinTx = useMoveStore((state) => state.takeCoinTx);
  const { setVaultName } = useHeirStore(); // Get setter function at component level
  const VaultName = useHeirStore((state) => state.VaultName);
  const [withdrawAmount, setWithdrawAmount] = useState({});
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [toggle, setToggle] = useState(false);
  const { coinsInVault, isLoading, setCoinsInVault, setLoading } =
    useCoinStore();

  // Use the sign and execute transaction hook directly
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();

  // Extract vault and owner cap using the utility function
  const { vaultAndCapQuery, ownerCapObjects, vaultID } = useVaultAndOwnerCap(
    account?.address,
    packageName
  );

  // Query dynamic fields using the utility function
  const vaultList = useVaultList(vaultID);

  // Log vault list data properly
  useEffect(() => {
    if (vaultList.data) {
      console.log("vaultList", vaultList.data);

      // Update vault name at the correct place
      if (vaultList.data?.data) {
        setVaultName(vaultList.data.data.map((item) => item.name));
      }
    }
  }, [vaultList.data, setVaultName]);

  // Get objectIds
  const getObjectIds = useCallback(() => {
    if (!vaultList?.data?.data) return [];
    return vaultList.data.data.map((item) => item.objectId);
  }, [vaultList?.data]);

  const objectIds = getObjectIds();

  // Query coin data
  const coinData = useSuiClientQuery(
    "multiGetObjects",
    {
      ids: objectIds,
      options: { showContent: true, showType: true },
    },
    {
      enabled: objectIds.length > 0,
      staleTime: 30000,

      // Add refetch trigger based on toggle state
      refetchInterval: false,
      refetchOnWindowFocus: false,
    }
  );

  // Log coin data properly
  useEffect(() => {
    if (coinData.data) {
      console.log("coinData", coinData.data);
    }
  }, [coinData.data]);

  // Add effect to refetch when toggle changes
  useEffect(() => {
    if (coinData) {
      coinData.refetch();
    }
  }, [toggle]);

  // Extract coin types (moved outside of effects)
  const coinTypes = useMemo(() => {
    return (
      coinData.data
        ?.map((coinObj) => {
          const type = coinObj?.data?.type || "";
          const typeMatch = type.match(/<(.+)>/);
          return typeMatch ? typeMatch[1] : null;
        })
        .filter(Boolean) || []
    );
  }, [coinData.data]);

  // Query metadata for each coin type - PROPERLY PLACED AT COMPONENT LEVEL
  const coinMetadataQueries = useSuiClientQueries({
    queries: coinTypes.map((coinType) => ({
      method: "getCoinMetadata",
      params: {
        coinType: coinType,
      },
    })),
    combine: (result) => {
      return {
        data: result.map((res) => res.data),
        isSuccess: result.every((res) => res.isSuccess),
        isPending: result.some((res) => res.isPending),
        isError: result.some((res) => res.isError),
      };
    },
    enabled: coinTypes.length > 0,
    staleTime: 30000,
  });

  // Log coin metadata properly
  useEffect(() => {
    if (coinMetadataQueries?.data) {
      console.log("Coin metadata:", coinMetadataQueries.data);
    }
  }, [coinMetadataQueries?.data]);

  // 處理代幣數據
  useEffect(() => {
    if (!coinData.data) return;

    try {
      const processedCoins = coinData.data
        .map((coinObj) => {
          if (!coinObj?.data?.content) return null;

          const type = coinObj.data.type || "";
          const typeMatch = type.match(/<(.+)>/);
          const fullCoinType = typeMatch ? typeMatch[1] : "Unknown";

          let formattedCoinType = "Unknown";
          if (fullCoinType !== "Unknown") {
            const parts = fullCoinType.split("::");
            if (parts.length > 0) {
              const address = parts[0];
              if (address.length > 10) {
                const prefix = address.substring(0, 7);
                const suffix = address.substring(address.length - 5);
                const remainingParts = parts.slice(1).join("::");
                formattedCoinType = `${prefix}...${suffix}::${remainingParts}`;
              } else {
                formattedCoinType = fullCoinType;
              }
            }
          }

          const coinSymbol = fullCoinType.split("::").pop() || "Unknown";
          const amount = coinObj.data?.content?.fields?.balance || "0";

          return [coinSymbol, formattedCoinType, amount, fullCoinType]; // Store the full coin type too
        })
        .filter((coin) => coin !== null);

      setCoinsInVault(processedCoins);
      setLoading(false); // 使用全局狀態的設置器
    } catch (error) {
      console.error("Error processing token data:", error);
      setLoading(false); // 使用全局狀態的設置器
    }
  }, [coinData.data]);

  // Add a function to normalize coin type addresses
  const normalizeType = useCallback((typeStr) => {
    return typeStr.replace(/^0x0+/, "0x");
  }, []);

  // 簡化 loading 邏輯
  useEffect(() => {
    const isDataLoading = !coinData.data && objectIds.length > 0;
    if (isLoading !== isDataLoading) {
      setLoading(isDataLoading);
    }
  }, [coinData.data, objectIds, isLoading]);

  // Handle withdraw from vault
  const handleWithdraw = async (coin, index) => {
    if (!withdrawAmount[index] || parseFloat(withdrawAmount[index]) <= 0) {
      alert("Please enter a valid amount to withdraw");
      return;
    }

    setIsWithdrawing(true);

    try {
      // Get coin metadata to calculate decimals
      const decimals = coinMetadataQueries.data[index]?.decimals;

      // Convert to smallest units
      const amountInSmallestUnit = BigInt(
        Math.floor(parseFloat(withdrawAmount[index]) * Math.pow(10, decimals))
      );

      // Get the name of asset in the vault - this should match the stored name in the vault
      const assetName = coin[0];
      console.log("coin", coin);

      // Get the original full coin type, not the formatted one with ellipses
      const coinType = normalizeType(coin[3] || coinTypes[index] || "");

      console.log("Using coin type for withdrawal:", coinType);

      // Create transaction
      const tx = takeCoinTx(
        ownerCapObjects[0].data.objectId,
        vaultID,
        coinType,
        Number(amountInSmallestUnit),
        coinType
      );

      // Execute transaction
      signAndExecuteTransaction(
        {
          transaction: tx,
          chain: "sui:testnet",
        },
        {
          onSuccess: (result) => {
            setWithdrawAmount({ ...withdrawAmount, [index]: "" });

            // Refresh the data after successful withdrawal
            setTimeout(() => {
              refreshData();
            }, 1000);
          },
        }
      );
      // Reset the withdrawal amount
    } catch (error) {
      console.error("Withdrawal failed:", error);
      alert("Failed to withdraw: " + (error.message || "Unknown error"));
    } finally {
      setIsWithdrawing(false);
    }
  };
  // Add a function to refresh the data
  const refreshData = useCallback(() => {
    setToggle((prev) => !prev);
    coinData.refetch();
    // coinMetadataQueries.refetch();
    vaultList.refetch();
    vaultAndCap.refetch();
    console.log("refetching");
  }, [toggle, coinData, coinMetadataQueries, vaultList, vaultAndCapQuery]);

  return (
    <div className='flex justify-center items-center w-full h-fit bg-white/30'>
      <div className='rounded-lg p-4 mb-4 w-1/2'>
        <div className='flex justify-between items-center mb-3'>
          <h3 className='text-lg text-gray-800 font-medium'>
            Your SeaVault Assets
          </h3>
          <CoinAdd
            coinsInVault={coinsInVault}
            onTransactionSuccess={refreshData}
          />
        </div>
        <div className='grid grid-cols-3 -gap-2'>
          <div className='text-black font-medium'>Coin Type</div>
          <div className='text-black font-medium'>Amount</div>
          <div className='text-black font-medium'>Action</div>

          {isLoading ? (
            <div className='col-span-3 py-4 text-center text-gray-500'>
              Loading assets...
            </div>
          ) : coinsInVault.length > 0 ? (
            coinsInVault.map((coin, index) => {
              // Only render if coin exists and has valid data
              if (!coin || !coin[2] || coin[2] == "0") return null;

              return (
                <React.Fragment key={index}>
                  <div className='py-2 border-t text-black dark:border-gray-700'>
                    {coin[0]}{" "}
                    <span className='text-xs text-gray-500'>{coin[1]}</span>
                  </div>
                  <div className='py-2 border-t text-black dark:border-gray-700'>
                    {coin[2] /
                      Math.pow(
                        10,
                        coinMetadataQueries.data[index]?.decimals
                      )}{" "}
                  </div>
                  <div className='py-2 border-t text-black dark:border-gray-700 flex items-center'>
                    <input
                      type='number'
                      placeholder='Amount'
                      className='w-20 px-2 py-1 mr-2 text-sm border rounded'
                      value={withdrawAmount[index] || ""}
                      onChange={(e) =>
                        setWithdrawAmount({
                          ...withdrawAmount,
                          [index]: e.target.value,
                        })
                      }
                      disabled={isWithdrawing}
                    />
                    <button
                      className='px-2 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 transition'
                      onClick={() => handleWithdraw(coin, index)}
                      disabled={isWithdrawing}
                    >
                      {isWithdrawing ? "..." : "Withdraw"}
                    </button>
                  </div>
                </React.Fragment>
              );
            })
          ) : (
            <div className='col-span-3 py-4 text-center text-gray-500'>
              No assets in your Vault
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VaultList;
