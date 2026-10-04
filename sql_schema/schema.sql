-- Schema-only DDL for the wallet-service database (no data).
-- Legacy subset only: db/sql.js (Sequelize models, auto-synced on start) is the source of truth
-- and defines additional tables.

CREATE DATABASE IF NOT EXISTS wallet_service;
USE wallet_service;
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `isActive` tinyint(1) DEFAULT '1',
  `merchantId` varchar(255) NOT NULL,
  `label` varchar(255) DEFAULT NULL,
  `apiKey` varchar(255) DEFAULT NULL,
  `secretKey` varchar(255) NOT NULL,
  `epoch` int(20) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `telegram_bots` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `update_id` int(11) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `usdt_clear_batches` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `merchantId` varchar(255) NOT NULL,
  `orderId` varchar(255) NOT NULL,
  `createdEpoch` int(11) NOT NULL,
  `confirmedEpoch` int(11) DEFAULT NULL,
  `amount` decimal(17,8) NOT NULL,
  `fee` decimal(6,4) NOT NULL,
  `paymentAddr` varchar(255) DEFAULT NULL,
  `destinationAddr` varchar(255) DEFAULT NULL,
  `funderAddr` varchar(255) DEFAULT NULL,
  `status` varchar(255) DEFAULT NULL,
  `txid` varchar(255) DEFAULT NULL,
  `sendFee` decimal(17,8) DEFAULT NULL,
  `sendFeeUsd` decimal(4,2) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `txid_UNIQUE` (`txid`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `usdt_tx_batches` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `merchantId` varchar(255) NOT NULL,
  `orderId` varchar(255) NOT NULL,
  `createdEpoch` int(11) NOT NULL,
  `amount` decimal(17,8) NOT NULL,
  `confirmedEpoch` int(11) DEFAULT NULL,
  `paymentAddr` varchar(255) NOT NULL,
  `status` varchar(255) DEFAULT 'PENDING',
  `ipn_status` varchar(45) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `paymentAddr_UNIQUE` (`paymentAddr`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `merchantId` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `withdraw_fee` decimal(6,4) NOT NULL DEFAULT '0.0150',
  `fee` decimal(6,4) NOT NULL DEFAULT '0.0230',
  `name` varchar(255) NOT NULL,
  `orgName` varchar(255) DEFAULT NULL,
  `country` varchar(45) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `code2fa` varchar(255) DEFAULT NULL,
  `code2faEpoch` int(11) DEFAULT NULL,
  `vericode` varchar(255) DEFAULT NULL,
  `vericodeEpoch` int(11) DEFAULT NULL,
  `isWithdrawing` tinyint(1) DEFAULT '0',
  `isVerified` tinyint(1) DEFAULT '0',
  `ipn_url` varchar(2083) DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1',
  `lastCountry` varchar(45) DEFAULT NULL,
  `lastRegion` varchar(45) DEFAULT NULL,
  `lastIP` varchar(45) DEFAULT NULL,
  `lastActive` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdEpoch` int(11) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_UNIQUE` (`email`),
  UNIQUE KEY `merchantId_UNIQUE` (`merchantId`),
  UNIQUE KEY `vericode_UNIQUE` (`vericode`),
  UNIQUE KEY `code2fa_UNIQUE` (`code2fa`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

CREATE TABLE IF NOT EXISTS `withdrawals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `merchantId` varchar(255) NOT NULL,
  `withdrawalId` varchar(255) NOT NULL,
  `createdEpoch` int(11) NOT NULL,
  `confirmedEpoch` int(11) DEFAULT NULL,
  `amount` decimal(17,8) NOT NULL,
  `fee` decimal(6,4) NOT NULL,
  `destinationAddr` varchar(255) NOT NULL,
  `senderAddr` varchar(255) DEFAULT NULL,
  `status` varchar(255) NOT NULL,
  `txid` varchar(255) DEFAULT NULL,
  `sendFee` decimal(17,8) DEFAULT NULL,
  `sendFeeUsd` decimal(4,2) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `withdrawalId_UNIQUE` (`withdrawalId`),
  UNIQUE KEY `txid_UNIQUE` (`txid`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;

