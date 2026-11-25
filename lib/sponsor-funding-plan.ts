/** Planning only. These estimates never update a price, ledger, or spendable balance. */
export const FUNDING_TARGET_YEN = 1_000_000;
export const FUNDING_ASSUMPTIONS = {
  consumptionTaxPercent: 10,
  domesticCardFeePercent: 3.6,
  stripeTaxFeePercent: 0.5,
  feeConsumptionTaxPercent: 10,
  defaultRewardPercent: 50,
  priceScenariosYen: [5_000, 30_000, 100_000],
  rounding: "税と手数料は1円未満を切り上げ、還元配分は1円未満を切り捨てます。",
} as const;

export type SponsorFundingPlan = {
  unitGrossYen: number;
  rewardPercent: number;
  targetYen: number;
  salesTaxReserveYen: number;
  cardProcessingFeeYen: number;
  cardFeeTaxYen: number;
  taxServiceFeeYen: number;
  taxServiceFeeTaxYen: number;
  totalFeesYen: number;
  netAfterReservesYen: number;
  rewardPerContractYen: number;
  retainedPerContractYen: number;
  contractsRequired: number | null;
  grossAtTargetYen: number | null;
  rewardAtTargetYen: number | null;
};

export function calculateSponsorFundingPlan(unitGrossYen = 5_000, rewardPercent = 50, targetYen = FUNDING_TARGET_YEN): SponsorFundingPlan {
  if (!Number.isSafeInteger(unitGrossYen) || unitGrossYen < 100 || unitGrossYen > 10_000_000) throw new Error("税込単価は100〜10,000,000円の整数で入力してください。");
  if (!Number.isSafeInteger(rewardPercent) || rewardPercent < 1 || rewardPercent > 100) throw new Error("還元配分は1〜100%の整数で入力してください。");
  if (!Number.isSafeInteger(targetYen) || targetYen < 1 || targetYen > 1_000_000_000) throw new Error("目標額をご確認ください。");
  const salesTaxReserveYen = Math.ceil(unitGrossYen / 11);
  const cardProcessingFeeYen = Math.ceil(unitGrossYen * 36 / 1000);
  const cardFeeTaxYen = Math.ceil(cardProcessingFeeYen / 10);
  const taxServiceFeeYen = Math.ceil(unitGrossYen / 200);
  const taxServiceFeeTaxYen = Math.ceil(taxServiceFeeYen / 10);
  const totalFeesYen = cardProcessingFeeYen + cardFeeTaxYen + taxServiceFeeYen + taxServiceFeeTaxYen;
  const netAfterReservesYen = Math.max(0, unitGrossYen - salesTaxReserveYen - totalFeesYen);
  const rewardPerContractYen = Math.floor(netAfterReservesYen * rewardPercent / 100);
  const retainedPerContractYen = netAfterReservesYen - rewardPerContractYen;
  const contractsRequired = rewardPerContractYen > 0 ? Math.ceil(targetYen / rewardPerContractYen) : null;
  return {
    unitGrossYen, rewardPercent, targetYen, salesTaxReserveYen, cardProcessingFeeYen, cardFeeTaxYen,
    taxServiceFeeYen, taxServiceFeeTaxYen, totalFeesYen, netAfterReservesYen, rewardPerContractYen, retainedPerContractYen,
    contractsRequired,
    grossAtTargetYen: contractsRequired === null ? null : contractsRequired * unitGrossYen,
    rewardAtTargetYen: contractsRequired === null ? null : contractsRequired * rewardPerContractYen,
  };
}
