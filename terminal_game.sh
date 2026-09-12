#!/bin/bash

# Terminal Game: Number Guessing Challenge
# Guess the number between 1-100. Can you beat the high score?

SCORE_FILE="$HOME/.guessing_game_score"
HIGH_SCORE=0

# Load high score if exists
if [ -f "$SCORE_FILE" ]; then
    HIGH_SCORE=$(cat "$SCORE_FILE")
fi

clear
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           🎲  NUMBER GUESSING CHALLENGE  🎲              ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Rules: I'm thinking of a number between 1 and 100."
echo "  Each wrong guess costs 1 point. Beat the high score!"
echo ""

# Difficulty selection
echo "Select difficulty:"
echo "  1) Easy   (1-50,   +2 bonus points if solved in ≤5 guesses)"
echo "  2) Medium (1-100,  +5 bonus points if solved in ≤7 guesses)"
echo "  3) Hard   (1-200,  +10 bonus points if solved in ≤9 guesses)"
echo "  4) Exit"
echo ""
read -p "Enter choice (1-4): " difficulty

case $difficulty in
    1) MAX_NUM=50; BONUS=2; MAX_BONUS_GUESSES=5;;
    2) MAX_NUM=100; BONUS=5; MAX_BONUS_GUESSES=7;;
    3) MAX_NUM=200; BONUS=10; MAX_BONUS_GUESSES=9;;
    4) echo "Thanks for playing! 👋"; exit 0;;
    *) echo "Invalid choice!"; exit 1;;
esac

# Generate random number
SECRET=$(( RANDOM % MAX_NUM + 1 ))
GUESSES=0
BONUS_EARNED=0

echo ""
echo "Game on! Range: 1-$MAX_NUM"
echo ""

while true; do
    read -p "Your guess: " guess
    
    # Validate input
    if ! [[ "$guess" =~ ^[0-9]+$ ]]; then
        echo "❌ Please enter a valid number!"
        continue
    fi
    
    GUESSES=$((GUESSES + 1))
    
    if [ "$guess" -lt "$SECRET" ]; then
        echo "⬆️  Too low!"
    elif [ "$guess" -gt "$SECRET" ]; then
        echo "⬇️  Too high!"
    else
        echo ""
        echo "🎉🎉🎉  CORRECT! You guessed it in $GUESSES tries! 🎉🎉🎉"
        
        # Calculate score
        SCORE=$((100 - GUESSES * 10))
        
        # Bonus for quick solve
        if [ "$GUESSES" -le "$MAX_BONUS_GUESSES" ]; then
            BONUS_EARNED=$BONUS
            SCORE=$((SCORE + BONUS))
            echo "⚡ Bonus: +$BONUS points for solving in ≤$MAX_BONUS_GUESSES guesses!"
        fi
        
        if [ "$SCORE" -lt 0 ]; then
            SCORE=0
        fi
        
        echo ""
        echo "Your score: $SCORE"
        
        # Update high score
        if [ "$SCORE" -gt "$HIGH_SCORE" ]; then
            HIGH_SCORE=$SCORE
            echo "$HIGH_SCORE" > "$SCORE_FILE"
            echo "🏆 NEW HIGH SCORE! Previous record was lower."
        else
            echo "Current high score: $HIGH_SCORE"
        fi
        
        break
    fi
done

echo ""
echo "Game over! Thanks for playing! 🎮"
