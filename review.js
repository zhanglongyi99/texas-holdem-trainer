export function extractDecisionSpots(handHistory, playerId) {
  const player = handHistory.players.find((item) => item.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);

  return handHistory.actions
    .filter((event) => event.type === "action" && event.playerId === playerId)
    .map((event, index) => ({
      id: `${playerId}-${index + 1}`,
      playerId,
      seat: player.seat,
      street: event.street,
      holeCards: [...player.holeCards],
      board: [...event.board],
      potBefore: event.potBefore,
      currentBetBefore: event.currentBetBefore,
      playerBetBefore: event.betBefore,
      stackBefore: event.stackBefore,
      toCall: event.toCallBefore,
      action: event.action,
      targetBet: event.targetBet,
      paid: event.paid,
      potAfter: event.potAfter,
      stackAfter: event.stackAfter,
    }));
}

export function toReviewSummary(handHistory, playerId) {
  const player = handHistory.players.find((item) => item.id === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  return {
    playerId,
    holeCards: player.holeCards,
    board: handHistory.board,
    startingStack: player.startingStack,
    endingStack: player.endingStack,
    net: player.endingStack - player.startingStack,
    committed: player.committed,
    folded: player.folded,
    allIn: player.allIn,
    result: handHistory.result,
    decisions: extractDecisionSpots(handHistory, playerId),
  };
}

export function toSolverSpot(spot) {
  return {
    game: "nlhe",
    street: spot.street,
    hero: {
      id: spot.playerId,
      seat: spot.seat,
      holeCards: spot.holeCards,
      stack: spot.stackBefore,
      bet: spot.playerBetBefore,
    },
    board: spot.board,
    pot: spot.potBefore,
    currentBet: spot.currentBetBefore,
    toCall: spot.toCall,
    actionTaken: {
      action: spot.action,
      targetBet: spot.targetBet,
      paid: spot.paid,
    },
  };
}
