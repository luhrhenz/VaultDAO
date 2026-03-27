use super::*;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Env,
};

fn setup() -> (Env, VaultDAOClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&sender, &10_000);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &crate::types::InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 100_000,
            daily_limit: 100_000,
            weekly_limit: 100_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: crate::types::VelocityConfig {
                limit: 100_000,
                window: 3600,
            },
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: soroban_sdk::Vec::new(&env),
            retry_config: crate::types::RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(&env),
            staking_config: crate::types::StakingConfig::default(),
            pre_execution_hooks: soroban_sdk::Vec::new(&env),
            post_execution_hooks: soroban_sdk::Vec::new(&env),
        },
    );

    (env, client, sender, recipient, token)
}

#[test]
fn test_create_stream() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let stream_id = client.create_stream(&sender, &recipient, &token, &1000, &100);
    assert_eq!(stream_id, 1);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_amount, 1000);
    assert_eq!(stream.rate, 10); // 1000 / 100
    assert_eq!(stream.claimed_amount, 0);
    assert_eq!(stream.status, StreamStatus::Active);
}

#[test]
fn test_claim_stream_accrual() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    client.create_stream(&sender, &recipient, &token, &1000, &100);

    // Advance 50 seconds — should be able to claim 50 * 10 = 500
    env.ledger().with_mut(|l| l.timestamp = 1050);
    let claimed = client.claim_stream(&recipient, &1);
    assert_eq!(claimed, 500);

    let stream = client.get_stream(&1);
    assert_eq!(stream.claimed_amount, 500);
}

#[test]
fn test_claim_does_not_exceed_total() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    client.create_stream(&sender, &recipient, &token, &1000, &100);

    // Advance past end
    env.ledger().with_mut(|l| l.timestamp = 2000);
    let claimed = client.claim_stream(&recipient, &1);
    assert_eq!(claimed, 1000);

    let stream = client.get_stream(&1);
    assert_eq!(stream.status, StreamStatus::Completed);
}

#[test]
fn test_pause_and_resume_stream() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    client.create_stream(&sender, &recipient, &token, &1000, &100);

    // Advance 20s then pause
    env.ledger().with_mut(|l| l.timestamp = 1020);
    client.pause_stream(&sender, &1);

    let stream = client.get_stream(&1);
    assert_eq!(stream.status, StreamStatus::Paused);
    assert_eq!(stream.accumulated_seconds, 20);

    // Advance another 30s while paused — should NOT accrue
    env.ledger().with_mut(|l| l.timestamp = 1050);
    client.resume_stream(&sender, &1);

    // Advance 10s after resume
    env.ledger().with_mut(|l| l.timestamp = 1060);
    let claimed = client.claim_stream(&recipient, &1);
    // 20 + 10 = 30 seconds * rate 10 = 300
    assert_eq!(claimed, 300);
}

#[test]
fn test_cancel_stream_returns_unclaimed_funds() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    client.create_stream(&sender, &recipient, &token, &1000, &100);

    // Advance 30s then cancel
    env.ledger().with_mut(|l| l.timestamp = 1030);
    let refund = client.cancel_stream(&sender, &1);

    // 30s * rate 10 = 300 accrued to recipient, 700 refunded to sender
    assert_eq!(refund, 700);

    let stream = client.get_stream(&1);
    assert_eq!(stream.status, StreamStatus::Cancelled);
}

#[test]
fn test_only_sender_can_pause() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    client.create_stream(&sender, &recipient, &token, &1000, &100);

    let result = client.try_pause_stream(&recipient, &1);
    assert!(result.is_err());
}

#[test]
fn test_only_sender_can_cancel() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    client.create_stream(&sender, &recipient, &token, &1000, &100);

    let result = client.try_cancel_stream(&recipient, &1);
    assert!(result.is_err());
}

#[test]
fn test_only_recipient_can_claim() {
    let (env, client, sender, recipient, token) = setup();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    client.create_stream(&sender, &recipient, &token, &1000, &100);
    env.ledger().with_mut(|l| l.timestamp = 1050);

    let result = client.try_claim_stream(&sender, &1);
    assert!(result.is_err());
}
