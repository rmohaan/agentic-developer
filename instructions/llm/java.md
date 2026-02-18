# Java Instructions

- Follow package structure and naming already used in the repository.
- For static methods, invoke as `ClassName.method(...)`, not via object instances.
- Use JUnit 5 unless project clearly uses a different framework.
- Use Mockito only when external dependencies require mocking.
- Keep test sources under `src/test/java` unless project uses alternate layout.
- For utility/static classes, write focused unit tests with direct static calls.
- Ensure tests compile and run with Maven/Gradle conventions used in the repo.
